import "server-only";
import { cookies } from "next/headers";
import { EncryptJWT, jwtDecrypt } from "jose";

export type SessionUser = {
  sub?: string;
  name?: string;
  email?: string;
  picture?: string;
};

export type Session = {
  accessToken: string;
  refreshToken?: string;
  /** Epoch seconds. */
  expiresAt: number;
  clientId: string;
  user: SessionUser;
};

export type PendingAuth = {
  state: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
  /** The message the visitor tried to send, sent for them once they're back. */
  prompt?: string;
};

const SESSION_COOKIE = "ps_session";
const PENDING_COOKIE = "ps_oauth";
// Browsers cap a cookie at ~4KB; long JWTs get split across numbered cookies.
const CHUNK_SIZE = 3600;
const MAX_CHUNKS = 6;

let keyPromise: Promise<Uint8Array> | null = null;

function encryptionKey(): Promise<Uint8Array> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET is missing or shorter than 32 characters. Set it in .env.local.",
    );
  }
  keyPromise ??= crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(secret))
    .then((buf) => new Uint8Array(buf));
  return keyPromise;
}

async function seal(payload: Record<string, unknown>, ttl: string) {
  return new EncryptJWT(payload)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .encrypt(await encryptionKey());
}

async function unseal<T>(token: string): Promise<T | null> {
  try {
    const { payload } = await jwtDecrypt(token, await encryptionKey());
    return payload as T;
  } catch {
    return null;
  }
}

const cookieBase = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function readSession(): Promise<Session | null> {
  const jar = await cookies();
  let token = "";
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const part = jar.get(`${SESSION_COOKIE}.${i}`)?.value;
    if (!part) break;
    token += part;
  }
  if (!token) return null;
  const session = await unseal<Session>(token);
  return session?.accessToken ? session : null;
}

export async function writeSession(session: Session) {
  const jar = await cookies();
  const token = await seal(session as unknown as Record<string, unknown>, "30d");
  const chunks = token.match(new RegExp(`.{1,${CHUNK_SIZE}}`, "g")) ?? [];
  if (chunks.length > MAX_CHUNKS) throw new Error("Session token too large");
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const name = `${SESSION_COOKIE}.${i}`;
    if (i < chunks.length) {
      jar.set(name, chunks[i], { ...cookieBase, maxAge: 60 * 60 * 24 * 30 });
    } else if (jar.get(name)) {
      jar.delete(name);
    }
  }
}

export async function clearSession() {
  const jar = await cookies();
  for (let i = 0; i < MAX_CHUNKS; i++) jar.delete(`${SESSION_COOKIE}.${i}`);
}

export async function writePendingAuth(pending: PendingAuth) {
  const jar = await cookies();
  jar.set(PENDING_COOKIE, await seal(pending, "10m"), {
    ...cookieBase,
    maxAge: 600,
  });
}

export async function takePendingAuth(): Promise<PendingAuth | null> {
  const jar = await cookies();
  const raw = jar.get(PENDING_COOKIE)?.value;
  jar.delete(PENDING_COOKIE);
  return raw ? unseal<PendingAuth>(raw) : null;
}
