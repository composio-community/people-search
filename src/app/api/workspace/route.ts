import { z } from "zod";
import { readSession } from "@/lib/session";
import { ownerKey, saveWorkspace } from "@/lib/persist";

const MAX_BYTES = 512_000;

// The browser owns the shape of its workspace (PersistedUI in chat-state); this
// only checks it's a small object of known keys.
const Body = z
  .object({
    chatId: z.string().regex(/^[\w-]{1,100}$/),
    patches: z.record(z.string(), z.unknown()),
    revealTrail: z.record(z.string(), z.unknown()),
    revealErrors: z.record(z.string(), z.string()),
    revealSpent: z.number().min(0),
    carriedSpent: z.number().min(0),
    saved: z.array(z.string()).max(1000),
    budget: z.number().min(0).max(25),
  })
  .partial();

/** Saves the workspace so a reload picks up where you left off. */
export async function PUT(request: Request) {
  const session = await readSession();
  if (!session) return Response.json({ error: "Not signed in" }, { status: 401 });
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return Response.json({ error: "Too large" }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return Response.json({ error: "Invalid workspace" }, { status: 400 });
  await saveWorkspace(await ownerKey(session), parsed.data);
  return new Response(null, { status: 204 });
}
