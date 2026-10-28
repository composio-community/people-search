import { connection } from "next/server";
import { Suspense } from "react";
import type { PersistedUI } from "@/components/chat-state";
import { ComposioMark } from "@/components/logos";
import { Workspace, type Restored } from "@/components/workspace";
import { modelLabel } from "@/lib/model";
import { loadChat, loadWorkspace, ownerKey } from "@/lib/persist";
import { readSession, type Session } from "@/lib/session";
import { compactMessages } from "@/lib/ui-message";

export default function Page({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<Boot />}>
      <Chat searchParams={searchParams} />
    </Suspense>
  );
}

/** Everyone gets the chat; sending a message is what asks a visitor to sign in. */
async function Chat({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const [session, params] = await Promise.all([readSession(), searchParams]);
  const text = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  const prompt = text("q")?.slice(0, 1500);
  return (
    <Workspace
      model={modelLabel()}
      authError={text("auth_error")}
      initialPrompt={prompt}
      restored={await restore(session, Boolean(prompt))}
      user={
        session
          ? { name: session.user.name, email: session.user.email, picture: session.user.picture }
          : null
      }
    />
  );
}

/** The chat and workspace a signed-in user left off with; a carried-over prompt starts a new chat. */
async function restore(session: Session | null, freshChat: boolean): Promise<Restored> {
  // A new chat id per request, not one baked into a prerender.
  await connection();
  const fresh = crypto.randomUUID();
  if (!session) return { chatId: fresh, messages: [], ui: null };
  const owner = await ownerKey(session);
  const workspace = await loadWorkspace(owner);
  const last = typeof workspace?.chatId === "string" ? workspace.chatId : null;
  const chatId = !freshChat && last ? last : fresh;
  return {
    chatId,
    messages: chatId === last ? compactMessages(await loadChat(owner, chatId)) : [],
    ui: workspace as Partial<PersistedUI> | null,
  };
}

function Boot() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <ComposioMark className="h-7 w-7 animate-pulse text-fg-3" />
    </div>
  );
}
