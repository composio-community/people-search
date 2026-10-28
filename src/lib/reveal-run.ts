import "server-only";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { mergePerson } from "./entities";
import { callMcpTool, instantCharge, McpAuthError } from "./mcp";
import { findPatch, verifyPatch } from "./reveal-parse";
import { nextRevealStep, type RevealStep } from "./reveal-plan";
import type { Person, RevealEvent, RevealMode, RevealRequest } from "./types";

type RevealTarget = RevealRequest["people"][number];

const MAX_STEPS = 4;

/**
 * Reveals one person by trying Instant providers one at a time, cheapest
 * first, until one finds what was asked for. Streams each attempt through
 * `emit` and returns what was spent.
 */
export async function revealOne(
  mcp: Client,
  target: RevealTarget,
  mode: RevealMode,
  emit: (e: RevealEvent) => void,
  signal: AbortSignal,
): Promise<number> {
  let who: Partial<Person> & { key: string } = { ...target };
  let patch: Partial<Person> = {};
  const tried = new Set<string>();
  let spent = 0;
  let lastError: string | undefined;

  for (let i = 0; i < MAX_STEPS; i++) {
    const step = nextRevealStep(who, mode, tried);
    if (!step) break;
    tried.add(step.slug);
    emit({ type: "attempt", key: target.key, attempt: { slug: step.slug, toolkit: step.toolkit, state: "running" } });
    const started = Date.now();
    try {
      const { found, charge } = await runStep(mcp, step, mode, signal);
      spent += charge;
      const hit = mode === "verify" ? Boolean(found?.emailStatus) : Boolean(found?.email);
      console.log(
        `[reveal] ${step.slug} ${hit ? "found" : found ? "partial" : "miss"} in ${Date.now() - started}ms, $${charge.toFixed(4)}`,
      );
      emit({
        type: "attempt",
        key: target.key,
        attempt: {
          slug: step.slug,
          toolkit: step.toolkit,
          state: hit ? "found" : found ? "partial" : "miss",
          charge,
          ms: Date.now() - started,
        },
      });
      if (found) {
        // Later steps can use what earlier ones learned, e.g. Apollo's full name.
        patch = { ...patch, ...found };
        who = { ...mergePerson({ sources: [], ...who } as Person, found), key: target.key };
      }
      if (hit) {
        emit({ type: "person", key: target.key, ok: true, patch: { ...patch, revealed: mode === "email" || undefined } });
        return spent;
      }
    } catch (err) {
      if (err instanceof McpAuthError || signal.aborted) throw err;
      lastError = err instanceof Error ? err.message.slice(0, 160) : "Provider error";
      emit({
        type: "attempt",
        key: target.key,
        attempt: { slug: step.slug, toolkit: step.toolkit, state: "error", ms: Date.now() - started, error: lastError },
      });
    }
  }

  const learned = Object.keys(patch).length > 0;
  emit({
    type: "person",
    key: target.key,
    ok: false,
    patch: learned ? patch : undefined,
    error: tried.size === 0 ? "Not enough detail to look this person up" : (lastError ?? "No provider found an email"),
  });
  return spent;
}

async function runStep(
  mcp: Client,
  step: RevealStep,
  mode: RevealMode,
  signal: AbortSignal,
): Promise<{ found: Partial<Person> | null; charge: number }> {
  const result = await callMcpTool(
    mcp,
    "COMPOSIO_MULTI_EXECUTE_TOOL",
    {
      tools: [{ tool_slug: step.slug, arguments: step.args }],
      sync_response_to_workbench: false,
      thought: mode === "verify" ? "Verify an email the user revealed." : "Find contact details for a person the user picked.",
      current_step: mode === "verify" ? "VERIFYING_EMAIL" : "REVEALING_CONTACT",
    },
    signal,
  );
  const charge = instantCharge(result.json);
  const item = (result.json as { data?: { results?: unknown[] } })?.data?.results?.[0] as
    | { response?: { successful?: boolean; data?: unknown; error?: unknown } }
    | undefined;
  const response = item?.response;
  if (!response || response.successful === false || response.error) {
    const err = response?.error;
    // A provider-side "not found" is a miss, not a failure.
    if (typeof err === "string" && /not.?found|no.?(result|match|email)|404/i.test(err)) {
      return { found: null, charge };
    }
    throw new Error(typeof err === "string" ? err : "Provider returned no result");
  }
  return { found: mode === "verify" ? verifyPatch(response.data) : findPatch(response.data, step.toolkit), charge };
}
