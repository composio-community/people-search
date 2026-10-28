import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { MCP_URL } from "./oauth";

export class McpAuthError extends Error {
  constructor() {
    super("Your Composio session expired. Sign in again.");
  }
}

export type McpTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

export type McpCallResult = {
  /** Text content the model reads. */
  text: string;
  /** Parsed JSON of the first text block, when it is JSON. */
  json: unknown;
  isError: boolean;
};

const TOOL_TIMEOUT_MS = 180_000;
const SETUP_TIMEOUT_MS = 30_000;

function isAuthFailure(err: unknown) {
  if (err instanceof UnauthorizedError) return true;
  const code = (err as { code?: unknown })?.code;
  return code === 401 || code === 403;
}

export async function connectMcp(accessToken: string, signal?: AbortSignal) {
  const client = new Client({ name: "people-search", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` }, signal },
  });
  try {
    await client.connect(transport, { timeout: SETUP_TIMEOUT_MS });
  } catch (err) {
    if (isAuthFailure(err)) throw new McpAuthError();
    throw err;
  }
  return client;
}

export async function listMcpTools(client: Client): Promise<McpTool[]> {
  const { tools } = await client.listTools(undefined, { timeout: SETUP_TIMEOUT_MS });
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as Record<string, unknown>,
  }));
}

export async function callMcpTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<McpCallResult> {
  try {
    const result = await client.callTool({ name, arguments: args }, undefined, {
      timeout: TOOL_TIMEOUT_MS,
      resetTimeoutOnProgress: true,
      signal,
    });
    const blocks = (result.content ?? []) as Array<{ type: string; text?: string }>;
    const text = blocks
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
    let json: unknown = result.structuredContent ?? null;
    if (json === null && text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { text: text || JSON.stringify(json ?? {}), json, isError: Boolean(result.isError) };
  } catch (err) {
    if (isAuthFailure(err)) throw new McpAuthError();
    throw err;
  }
}

/** Instant charges are reported on the top-level `instant_charge` object. */
export function instantCharge(json: unknown): number {
  const charge = (json as { instant_charge?: { amount?: string | number } } | null)
    ?.instant_charge?.amount;
  const n = typeof charge === "string" ? parseFloat(charge) : charge;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}
