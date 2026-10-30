import { actionLabel, toolkitOf } from "./catalog";
import type { Price, StepInfo } from "./types";

type Loose = Record<string, unknown>;

/**
 * The provider calls inside one Composio meta-tool call, from its (possibly
 * still streaming) input. Used by the server for budgeting and by the client
 * for labels, logos and prices.
 */
export function describeSteps(name: string, args: Loose | undefined, prices: Record<string, Price> = {}): StepInfo[] {
  const input = args ?? {};
  if (name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
    const tools = Array.isArray(input.tools) ? (input.tools as Loose[]) : [];
    return tools
      .filter((t) => t && typeof t.tool_slug === "string" && t.tool_slug)
      .map((t, index) => {
        const slug = String(t.tool_slug);
        return {
          index,
          slug,
          toolkit: toolkitOf(slug),
          label: actionLabel(slug),
          args: (t.arguments as Loose) ?? {},
          price: prices[slug],
        };
      });
  }
  if (name === "COMPOSIO_SEARCH_TOOLS" && Array.isArray(input.queries)) {
    const useCases = (input.queries as Loose[])
      .map((q) => (typeof q?.use_case === "string" ? q.use_case : undefined))
      .filter(Boolean);
    return [{ index: 0, slug: name, toolkit: "composio", label: actionLabel(name), args: { use_cases: useCases } }];
  }
  return [{ index: 0, slug: name, toolkit: "composio", label: actionLabel(name), args: input }];
}

// Prices that bill per item returned or enriched, rather than per call.
const PER_ITEM = /\bper (?:\w+ )?(?:returned )?(?:person|people|profile|record|result|contact|lead|employee|job|posting|listing)s?\b/i;
const COUNT_KEYS = ["per_page", "page_size", "limit", "size", "num_results", "max_results", "count", "top_k"];
const LIST_KEYS = ["details", "people", "persons", "records", "emails", "linkedin_urls", "ids", "domains"];
/** What providers return when no count is given; assumed so the estimate errs high. */
const DEFAULT_PAGE = 25;
/** Token-priced calls (Jev): the arguments at ~4 characters a token, plus the model's own prompt (measured ~340; rounded up). */
const CHARS_PER_TOKEN = 4;
const TOKEN_OVERHEAD = 400;

export type StepEstimate = { qty: number; min: number; max: number; perItem: boolean; guessedQty: boolean };

/** One provider call's cost before it runs: unit price × how many items the arguments ask for. */
export function estimateStep(step: StepInfo): StepEstimate | null {
  const price = step.price;
  if (!price) return null;
  if (price.perToken) {
    const qty = Math.ceil(JSON.stringify(step.args).length / CHARS_PER_TOKEN) + TOKEN_OVERHEAD;
    return { qty, min: price.min * qty, max: price.max * qty, perItem: false, guessedQty: true };
  }
  const perItem = PER_ITEM.test(price.text);
  let qty = 1;
  let guessedQty = false;
  if (perItem) {
    const list = LIST_KEYS.map((k) => step.args[k]).find(Array.isArray);
    const count = COUNT_KEYS.map((k) => Number(step.args[k])).find((n) => Number.isFinite(n) && n > 0);
    if (list) qty = Math.max(1, list.length);
    else if (count) qty = Math.floor(count);
    else if (!/enrich/i.test(price.text)) {
      qty = DEFAULT_PAGE;
      guessedQty = true;
    }
  }
  return { qty, min: price.min * qty, max: price.max * qty, perItem, guessedQty };
}

/** Chip label from the tool input, as the playground does it. */
export function toolChipLabel(name: string, args: Loose | undefined) {
  const input = args ?? {};
  if (name === "COMPOSIO_SEARCH_TOOLS") return "Searching for the right tools";
  if (name === "COMPOSIO_GET_TOOL_SCHEMAS") return "Reading tool schemas";
  if (name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
    if (typeof input.thought === "string" && input.thought.trim()) return input.thought.trim();
    const n = describeSteps(name, input).length;
    if (n) return `Running ${n} tool${n === 1 ? "" : "s"}`;
    return "Preparing tools";
  }
  return actionLabel(name);
}
