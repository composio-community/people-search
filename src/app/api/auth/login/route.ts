import { NextResponse } from "next/server";
import { authorizeUrl, clientIdFor, pkcePair, randomState, redirectUriFor } from "@/lib/oauth";
import { writePendingAuth } from "@/lib/session";

/**
 * Starts the connect.composio.dev/mcp OAuth flow. `?q=` carries the message a
 * signed-out visitor tried to send, so it goes out once they're back.
 */
export async function GET(request: Request) {
  // Read the request first so prerendering bails out before the try block.
  const redirectUri = redirectUriFor(request);
  const prompt = new URL(request.url).searchParams.get("q")?.trim().slice(0, 1500) || undefined;
  try {
    const clientId = await clientIdFor(redirectUri);
    const { verifier, challenge } = await pkcePair();
    const state = randomState();
    await writePendingAuth({ state, verifier, clientId, redirectUri, prompt });
    return NextResponse.redirect(await authorizeUrl({ clientId, redirectUri, challenge, state }));
  } catch (err) {
    console.error("[auth/login]", err);
    const message = err instanceof Error ? err.message : "Could not reach Composio";
    const home = new URL("/", request.url);
    home.searchParams.set("auth_error", message);
    if (prompt) home.searchParams.set("q", prompt);
    return NextResponse.redirect(home);
  }
}
