import type { UIMessage } from "ai";
import type { Company, Person, Price, StepResult } from "./types";

/** Message metadata the server attaches while streaming (playground style). */
export type AgentMetadata = {
  startedAt?: number;
  finishedAt?: number;
  /** When each tool call started, keyed by toolCallId; drives the live timers. */
  toolStartedAt?: Record<string, number>;
  model?: string;
};

export type AgentData = {
  /** Transient: what the server is doing before any part exists ("Connecting to Composio…"). */
  status: { text: string };
  /** Persistent notices such as running out of steps. */
  notice: { text: string };
};

export type AgentUIMessage = UIMessage<AgentMetadata, AgentData>;

/** What every Composio tool call resolves to. `text` is for the model only and never reaches the browser. */
export type McpToolOutput = {
  successful: boolean;
  error?: string;
  /** Refused before running: spend cap, research budget or a meta tool in the batch. */
  blocked?: boolean;
  durationMs: number;
  charge: number;
  steps?: StepResult[];
  people?: Person[];
  companies?: Company[];
  prices?: Record<string, Price>;
  toolkits?: string[];
  /** Appended to what the model reads, e.g. a reminder to wrap up. */
  nudge?: string;
  text?: string;
};

export type PresentOutput = { shown: true; people: number; companies: number };

export const MCP_TOOL_NAMES = [
  "COMPOSIO_SEARCH_TOOLS",
  "COMPOSIO_GET_TOOL_SCHEMAS",
  "COMPOSIO_MULTI_EXECUTE_TOOL",
] as const;

/** What the browser gets of a tool output: no model-only text, short raw previews. */
export function compactOutput(output: unknown): unknown {
  if (!output || typeof output !== "object" || !("text" in output)) return output;
  const { text: _text, ...rest } = output as McpToolOutput;
  void _text;
  return { ...rest, steps: rest.steps?.map((s) => ({ ...s, raw: s.raw?.slice(0, 2000) })) };
}

/** Stored messages trimmed the same way the live stream is, for loading a chat into the page. */
export function compactMessages(messages: AgentUIMessage[]): AgentUIMessage[] {
  return messages.map((m) => ({
    ...m,
    parts: m.parts.map((part) =>
      "toolCallId" in part && part.state === "output-available"
        ? ({ ...part, output: compactOutput(part.output) } as typeof part)
        : part,
    ),
  }));
}
