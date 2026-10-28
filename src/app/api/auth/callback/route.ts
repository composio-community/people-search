import { NextResponse } from "next/server";
import { exchangeCode } from "@/lib/oauth";
import { takePendingAuth, writeSession } from "@/lib/session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const home = new URL("/", process.env.APP_URL ?? url.origin);
  const pending = await takePendingAuth();
  // The message they tried to send comes back with them: sent on success,
  // left in the composer on failure.
  if (pending?.prompt) home.searchParams.set("q", pending.prompt);
  const fail = (message: string) => {
    home.searchParams.set("auth_error", message);
    return NextResponse.redirect(home);
  };

  const error = url.searchParams.get("error");
  if (error) return fail(url.searchParams.get("error_description") ?? error);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!pending || !code || state !== pending.state) {
    return fail("Sign-in expired or was started in another tab. Try again.");
  }

  try {
    const session = await exchangeCode({
      code,
      verifier: pending.verifier,
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
    });
    await writeSession(session);
    return NextResponse.redirect(home);
  } catch (err) {
    console.error("[auth/callback]", err);
    return fail(err instanceof Error ? err.message : "Token exchange failed");
  }
}
