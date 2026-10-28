import { z } from "zod";
import { agentResponse } from "@/lib/agent";
import { activeSession } from "@/lib/oauth";
import { ownerKey, saveWorkspace } from "@/lib/persist";
import type { AgentUIMessage } from "@/lib/ui-message";

export const maxDuration = 300;

const Body = z.object({
  id: z.string().min(1).max(100),
  message: z.custom<AgentUIMessage>((v) => typeof v === "object" && v !== null && "parts" in v),
  budget: z.number().min(0).max(25).default(0.25),
  spentBefore: z.number().min(0).default(0),
  revealed: z
    .array(
      z.object({
        name: z.string(),
        title: z.string().optional(),
        company: z.string().optional(),
        email: z.string().optional(),
        status: z.string().optional(),
      }),
    )
    .max(100)
    .default([]),
});

export async function POST(request: Request) {
  const session = await activeSession();
  if (!session) return Response.json({ error: "Not signed in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { id, message, budget, spentBefore, revealed } = parsed.data;
  const owner = await ownerKey(session);
  // A reload reopens the chat you last wrote in.
  await saveWorkspace(owner, { chatId: id });
  return agentResponse({
    chatId: id,
    owner,
    accessToken: session.accessToken,
    message,
    budget,
    spentBefore,
    revealed,
    signal: request.signal,
  });
}
