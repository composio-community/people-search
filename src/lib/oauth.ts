import "server-only";
import { decodeJwt } from "jose";
import { readSession, writeSession, type Session, type SessionUser } from "./session";

/**
 * Sign-in is the MCP authorization flow of connect.composio.dev/mcp:
 * OAuth 2.1 with PKCE and dynamic client registration (RFC 7591), with the
 * MCP server as the resource (RFC 8707). The resulting bearer token is what
 * the agent sends to the MCP server, so Instant calls bill the signed-in
 * user's Composio wallet.
 */
export const MCP_URL =
  process.env.COMPOSIO_MCP_URL ?? "https://connect.composio.dev/mcp";

type AuthServerMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
};

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
};

const SCOPES = "openid profile email offline_access";

const g = globalThis as typeof globalThis & {
  __psAuthMeta?: Promise<AuthServerMetadata>;
  __psClients?: Map<string, Promise<string>>;
};

export function authServerMetadata(): Promise<AuthServerMetadata> {
  g.__psAuthMeta ??= (async () => {
    const resourceMeta = await fetchJson<{ authorization_servers?: string[] }>(
      new URL("/.well-known/oauth-protected-resource", MCP_URL).toString(),
    );
    const issuer = resourceMeta.authorization_servers?.[0] ?? new URL(MCP_URL).origin;
    return fetchJson<AuthServerMetadata>(
      new URL("/.well-known/oauth-authorization-server", issuer).toString(),
    );
  })().catch((err) => {
    g.__psAuthMeta = undefined;
    throw err;
  });
  return g.__psAuthMeta;
}

/** One dynamically registered public client per redirect URI, reused across sign-ins. */
export function clientIdFor(redirectUri: string): Promise<string> {
  g.__psClients ??= new Map();
  let pending = g.__psClients.get(redirectUri);
  if (!pending) {
    pending = registerClient(redirectUri).catch((err) => {
      g.__psClients?.delete(redirectUri);
      throw err;
    });
    g.__psClients.set(redirectUri, pending);
  }
  return pending;
}

async function registerClient(redirectUri: string): Promise<string> {
  const meta = await authServerMetadata();
  if (!meta.registration_endpoint) {
    throw new Error("Composio does not advertise dynamic client registration");
  }
  const res = await fetch(meta.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "People Search · Composio Instant",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!res.ok) throw new Error(`Client registration failed (${res.status})`);
  const body = (await res.json()) as { client_id: string };
  return body.client_id;
}

function base64url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64url");
}

export async function pkcePair() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

export function randomState() {
  return base64url(crypto.getRandomValues(new Uint8Array(24)));
}

export async function authorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}) {
  const meta = await authServerMetadata();
  const url = new URL(meta.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
    state: opts.state,
    scope: SCOPES,
    resource: MCP_URL,
  }).toString();
  return url.toString();
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const meta = await authServerMetadata();
  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({ ...params, resource: MCP_URL }).toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Token request failed (${res.status}) ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function exchangeCode(opts: {
  code: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
}): Promise<Session> {
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    code_verifier: opts.verifier,
  });
  return toSession(tokens, opts.clientId);
}

function toSession(tokens: TokenResponse, clientId: string, previous?: Session): Session {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? previous?.refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + (tokens.expires_in ?? 3600),
    clientId,
    user: userFrom(tokens) ?? previous?.user ?? {},
  };
}

function userFrom(tokens: TokenResponse): SessionUser | null {
  // The id_token comes straight from the token endpoint over TLS, so its
  // claims are only used for display. Fall back to a JWT access token.
  for (const jwt of [tokens.id_token, tokens.access_token]) {
    if (!jwt) continue;
    try {
      const c = decodeJwt(jwt);
      const name =
        (c.name as string | undefined) ??
        [c.given_name, c.family_name].filter(Boolean).join(" ") ??
        undefined;
      const email = c.email as string | undefined;
      if (name || email) {
        return {
          sub: c.sub,
          name: name || undefined,
          email,
          picture: c.picture as string | undefined,
        };
      }
    } catch {
      // Opaque token, nothing to read.
    }
  }
  return null;
}

/**
 * Returns a session with a usable access token, refreshing it when it is
 * about to expire. Only call from Route Handlers (it may rewrite the cookie).
 */
export async function activeSession(): Promise<Session | null> {
  const session = await readSession();
  if (!session) return null;
  const now = Math.floor(Date.now() / 1000);
  if (session.expiresAt - 60 > now) return session;
  if (!session.refreshToken) return null;
  try {
    const tokens = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
      client_id: session.clientId,
    });
    const next = toSession(tokens, session.clientId, session);
    await writeSession(next);
    return next;
  } catch {
    return null;
  }
}

export function redirectUriFor(request: Request) {
  const origin = process.env.APP_URL ?? new URL(request.url).origin;
  return new URL("/api/auth/callback", origin).toString();
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${url} failed (${res.status})`);
  return (await res.json()) as T;
}
