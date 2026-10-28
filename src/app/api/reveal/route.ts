import { z } from "zod";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { connectMcp, McpAuthError } from "@/lib/mcp";
import { activeSession } from "@/lib/oauth";
import { revealOne } from "@/lib/reveal-run";
import type { RevealEvent } from "@/lib/types";

export const maxDuration = 120;

const Target = z.object({
  key: z.string(),
  apolloId: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  name: z.string().optional(),
  company: z.string().optional(),
  companyDomain: z.string().optional(),
  linkedinUrl: z.string().optional(),
  email: z.string().optional(),
});

const Body = z.object({
  mode: z.enum(["email", "verify"]),
  people: z.array(Target).min(1).max(10),
});

const CONCURRENCY = 4;

/**
 * Tries Instant providers one at a time per person, cheapest first, and stops
 * at the first that finds what was asked for. Each attempt is streamed so the
 * row shows which provider is running, which missed, and what the hit cost.
 */
export async function POST(request: Request) {
  const session = await activeSession();
  if (!session) return Response.json({ error: "Not signed in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { mode, people } = parsed.data;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: RevealEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // Client went away.
        }
      };
      let mcp: Client | undefined;
      let total = 0;
      try {
        mcp = await connectMcp(session.accessToken, request.signal);
        const queue = [...people];
        const worker = async () => {
          for (let target = queue.shift(); target; target = queue.shift()) {
            total += await revealOne(mcp!, target, mode, emit, request.signal);
          }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, people.length) }, worker));
        emit({ type: "done", charge: total });
      } catch (err) {
        if (err instanceof McpAuthError) {
          emit({ type: "error", code: "auth", message: err.message });
        } else if (!request.signal.aborted) {
          console.error("[reveal]", err);
          emit({ type: "error", message: err instanceof Error ? err.message : "Reveal failed" });
        }
      } finally {
        await mcp?.close().catch(() => {});
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
