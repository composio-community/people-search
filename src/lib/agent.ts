import "server-only";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  jsonSchema,
  stepCountIs,
  streamText,
  tool,
  type ModelMessage,
  type StreamTextTransform,
  type TextStreamPart,
  type ToolSet,
  type UIMessageChunk,
} from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { formatRange, formatUsd, KNOWN_PRICES, pricesFromSearch, toolkitOf } from "./catalog";
import { extractEntities, mergeCompany, mergePerson } from "./entities";
import {
  callMcpTool,
  connectMcp,
  instantCharge,
  listMcpTools,
  McpAuthError,
  type McpTool,
} from "./mcp";
import { MODEL, modelLabel } from "./model";
import { loadChat, saveChat } from "./persist";
import { describeSteps, estimateStep } from "./steps";
import { isRunaway, TextGuard } from "./stream-guard";
import type { Company, Person, Price, StepInfo, StepResult } from "./types";
import {
  compactOutput,
  MCP_TOOL_NAMES,
  type AgentUIMessage,
  type McpToolOutput,
} from "./ui-message";

const MAX_STEPS = 16;
/** Tool batches before the model is reminded to wrap up, and before batches are refused. */
const RESEARCH_NUDGE_AT = 3;
const RESEARCH_LIMIT = 5;
/** Attempts when the model writes a tool call as text or a tool call runs away. */
const MAX_ATTEMPTS = 3;
const MAX_RESULT_CHARS = 90_000;
/** A reply longer than this has run away (a full board plus an intro is ~4K; 15 job cards with URLs ~5K). */
const MAX_REPLY_CHARS = 16_000;

const g = globalThis as typeof globalThis & {
  __psPrices?: Record<string, Price>;
  __psTools?: Map<string, { tools: McpTool[]; at: number }>;
};
/** Instant prices are global, so every search result refines this table. */
const prices = (g.__psPrices ??= { ...KNOWN_PRICES });

/** The MCP tool list per sign-in, so a turn can start the model while the connection opens. */
const toolLists = (g.__psTools ??= new Map());
const TOOL_LIST_TTL_MS = 30 * 60_000;

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: { "X-Title": "People Search · Composio Instant" },
});

const SYSTEM_PROMPT = `You are People Search, a sourcing agent for recruiters. Your main job is to turn a hiring brief (role, seniority, skills, location, target companies, background) into a strong shortlist of candidates. You also help with business development: which companies are hiring for a role, and who the hiring manager or in-house recruiter is. You work through the Composio MCP server, which gives you Composio Instant: paid data providers (Apollo, Hunter, ContactOut, Crustdata and others) that the user pays for per call from their Composio wallet, at provider price with no markup. Every tool response reports its cost in \`instant_charge\`.

Working with Composio
- Start a new kind of task with COMPOSIO_SEARCH_TOOLS. Its response lists tool slugs, a recommended plan, known pitfalls, and each Instant tool's price under toolkit_connection_statuses[].instant_account.prices. Reuse the session id it returns in later meta-tool calls.
- Run tools with COMPOSIO_MULTI_EXECUTE_TOOL, batching independent calls into one request. Fetch a schema with COMPOSIO_GET_TOOL_SCHEMAS when you are unsure of arguments.
- Use tools that run on the Instant account (instant_account.allowed_tool_slugs) or on apps the user already connected. Don't start connection flows.
- There is no workbench, sandbox or bash here. Tool results come back inline; read them directly and never write code to parse them.
- Call tools only through the tool-calling interface, never by writing tool-call markup in your reply.

Sourcing (how good sourcers work)
- Read the brief like an intake: at most three must-haves, the rest nice-to-haves. When it leaves stack, stage or location open, pick a sensible reading and say so in one line.
- Don't match on the title alone. Most qualified people don't use the exact title, so search its variants and the evidence behind it ("first engineer", "engineer #2", "built from scratch"), and for skills a title doesn't show (shipped LLM inference, scaled a payments stack), a target list of companies doing that work, in the same domain and a stage or two ahead.
- Rank by must-haves met, then evidence of ownership (built something from zero, owned a system end to end), then signs they may be open to a move (two to four years in the role, their company acquired or cutting staff, Open to Work), then nice-to-haves. Not by seniority or fame. Leave out people who miss a must-have instead of padding the list; if the brief is too narrow to fill, say what you relaxed.
- Score the candidates with Jev before you present them. Jev (JEV_EVALUATE_STATE, TypeSafe AI's evaluation model on Instant, a tiny fraction of a cent per candidate) judges a record against questions you define. Run one call per candidate, all in one COMPOSIO_MULTI_EXECUTE_TOOL batch: \`state\` is the brief plus the candidate's record as the tool returned it, and \`questions\` has a \`fit\` score over the must-haves, e.g. {"fit": {"type": "score", "criteria": ["Misses a must-have", "Meets some must-haves", "Meets all must-haves", "Meets all must-haves with clear evidence of the work"], "instructions": "Must-haves: <the brief's must-haves>"}}, plus a \`choice\` question for any must-have the title doesn't show, whose \`criteria\` maps each option to when it applies, e.g. {"fintech": {"type": "choice", "criteria": {"yes": "The record shows fintech or payments work", "no": "It shows none", "unclear": "It doesn't say"}}}. Rank by Jev's fit score, leave out anyone it scores as missing a must-have, and say in the line before the board that Jev scored them.
- Each note cites evidence from the person's record (stage, scope, outcome, plus tenure or location), never adjectives, and names a real risk when there is one (under a year in the role, a location mismatch).
- An email from a reveal is usually a work address; say so when you mention it. If asked to draft outreach, keep the first note under 400 characters with the specific reason they fit, plus two or three short follow-ups.

Spending
- For researchers and papers, use OpenAlex (OPENALEX_* tools, free and fast; works list authors with their institutions) before any web or Scholar search.
- Several Instant providers find people. Apollo's people search is free but returns only titles, companies, first names and masked surnames (like "Cu***s"). CompanyEnrich and ContactOut return full names and LinkedIn URLs for about two cents a person; People Data Labs is precise but costs about $0.25 a person. Check current prices in the search results, start with the cheapest that fits, and try another provider when one comes back thin.
- Contact details cost money, so get them only when the user asks, and only for the people they asked about. For a work email, try the cheapest finders first: Tomba and Hunter only bill when they find one; Apollo enrichment costs more but also unmasks Apollo surnames. Verify with ZeroBounce. Before a paid batch, say in a progress update what it will cost.
- For sourcing and list-building requests, don't reveal anyone: present the shortlist. Every person on the board has a Reveal button showing its price; the user clicks it to pay for that one contact.
- The turn context gives a per-request spending cap. Calls that would exceed it are blocked; if that happens, tell the user and mention they can raise the cap in the composer.

Presenting
- Show people as a board by writing a fenced block with the language "people" in your reply. The app renders it as an interactive board, row by row as you write, with a Reveal button per person. Exactly this shape:

\`\`\`people
title: <short board title, e.g. Staff ML engineers in SF>
<ref> | <name> | <the evidence they fit, under 12 words, e.g. Eng #2; built the payments ledger from zero · 3 yrs in role>
\`\`\`

- One row per person, best fits first, at most 15, leaving out records that don't fit the request. \`ref\` is the record's id exactly as the tool returned it (Apollo person id, OpenAlex author id), else their LinkedIn URL or email; the board uses it to attach the full record. Write names as returned and keep obfuscated last names obfuscated.
- For companies, write a "companies" block with the same shape and the company's domain as the ref.
- Before the block, one short sentence at most, saying how wide the search was (how many matches the search found and how many you read). After it, two to four sentences: what you found, caveats worth knowing (such as a must-have you couldn't confirm), and one refinement that would widen or narrow the search. Don't repeat the rows as a list.
- Never invent people, titles or emails. If nothing matches, say so and suggest how to broaden the search.

Jobs (business development)
- When the user asks which companies are hiring for a role, use the Job Search toolkit (JOB_SEARCH_*: LinkedIn, Indeed, Glassdoor, Google Jobs and Bing job search; prices are fractions of a cent per request) and PredictLeads job openings for a specific company's open roles. Check prices in the search results and start with the cheapest source that covers the request. One or two searches are usually enough; merge results and drop duplicates.
- Respect the request's role, seniority, location or remote preference, salary and recency. Prefer postings from the last few weeks and say so when results are older.
- Show postings as a fenced block with the language "jobs". The app renders each line as a job card with a "View posting" link (it opens the posting on its job board; the app never applies for the user) and a "Who's hiring" button, row by row as you write. Exactly this shape, one posting per line, "-" for anything unknown:

\`\`\`jobs
title: <short title, e.g. Companies hiring Rust engineers>
<Company (company-domain.com)> | <role> | <location, or Remote> | <salary as listed> | <posted, e.g. 3 days ago> | <posting URL> | <why it's a lead, under 12 words>
\`\`\`

- Up to 15 postings, best leads first. Copy posting URLs and salaries exactly from tool output; never invent them. Add the company's domain in parentheses when you know it.
- After the block, two or three sentences: what you found, anything worth knowing (salary ranges, how fresh the postings are), and that "Who's hiring" on any card finds the people behind it.
- When asked who's hiring for a role: search people at that company (Apollo people search is free) for the likely hiring manager (the head of that team, e.g. Engineering Manager or Head of Design for the role's function) and for in-house recruiters or talent partners. Show them in a people block, best guess first, with notes saying which is the likely hiring manager and which is a recruiter. When a request asks for hiring managers alongside the postings, do this for the top few companies in one batch, after the jobs block.

Intros and outreach
- When the user wants an intro, a warm path, or something to say to a candidate or hiring manager: identify the person (show them in a people block), then research two or three specific, recent hooks with Instant tools before writing. Good sources: their LinkedIn or X profile and posts (ScrapeCreators), podcast appearances (Listen Notes), company news (Akta, Context.dev), hiring signals (PredictLeads), papers (OpenAlex). These calls cost cents; say so in a progress update.
- Then write the intro in your reply as one fenced block with the language "intro". The app renders it as an email card with Copy and Open in Gmail. Use exactly this shape, plain text, body under 130 words:

\`\`\`intro
To: [mutual's name]
About: <the person's id from the tool output, else their name>
Subject: <subject line>

<email body with line breaks>

Hooks:
- <fact the email leans on> | <source, e.g. LinkedIn post, 20 Oct> | <url if a tool returned one>
\`\`\`

- Default to a forwardable intro the user sends to a mutual connection: lead with why this person, why now, and include a two-sentence blurb the mutual can forward. Use [square-bracket placeholders] for anything you don't know, such as [your name]. Every hook must come from a tool result. Never invent a relationship, a shared history or a quote.
- After the block, add one or two sentences at most. Revealing the target's email is optional for a forwardable intro; leave it to the Reveal button unless the user asks for a direct note.`;

const NUDGE =
  "(Your last reply wrote a tool call as text, or ran away, so it was cut off. Call tools through the tool-calling interface with short arguments, and keep the reply short: one people block and a few sentences.)";

export type AgentRequest = {
  chatId: string;
  /** Whose chat this is; full conversations, tool outputs included, are stored per user (lib/persist). */
  owner: string;
  accessToken: string;
  message: AgentUIMessage;
  budget: number;
  spentBefore: number;
  revealed: Array<{ name: string; title?: string; company?: string; email?: string; status?: string }>;
  signal: AbortSignal;
};

type RunState = { budget: number; spent: number; rounds: number };
type Log = (msg: string) => void;

const since = (t: number) => `${((Date.now() - t) / 1000).toFixed(1)}s`;

export class ConfigError extends Error {}

/** Streams one agent turn as an AI SDK UI message stream (SSE). */
export async function agentResponse(req: AgentRequest): Promise<Response> {
  const history = await loadChat(req.owner, req.chatId);
  // A retry resends the stored last question; don't add it twice.
  const messages: AgentUIMessage[] = history.at(-1)?.id === req.message.id ? history : [...history, req.message];
  // Stored before the run, so a reload mid-turn still shows the question.
  await saveChat(req.owner, req.chatId, messages);
  const runStart = Date.now();
  const log: Log = (msg) => console.log(`[agent] +${since(runStart)} ${msg}`);

  const stream = createUIMessageStream<AgentUIMessage>({
    originalMessages: messages,
    onError: (err) => friendlyError(err),
    onFinish: async ({ messages: finished }) => {
      // A turn that failed before writing anything leaves an empty reply; keep the question only.
      await saveChat(
        req.owner,
        req.chatId,
        finished.filter((m) => m.role !== "assistant" || m.parts.some((p) => p.type !== "step-start")),
      );
    },
    execute: async ({ writer }) => {
      if (!process.env.OPENROUTER_API_KEY) {
        throw new ConfigError("OPENROUTER_API_KEY is not set on the server. Add it to .env.local.");
      }
      const status = (text: string) => writer.write({ type: "data-status", data: { text }, transient: true });

      const t = Date.now();
      const mcpReady = connectMcp(req.accessToken, req.signal);
      mcpReady.then(
        () => log(`mcp connected in ${since(t)}`),
        () => toolLists.delete(req.accessToken),
      );
      try {
        const cached = toolLists.get(req.accessToken);
        let mcpTools: McpTool[];
        if (cached && Date.now() - cached.at < TOOL_LIST_TTL_MS) {
          mcpTools = cached.tools;
        } else {
          status("Connecting to Composio…");
          mcpTools = await listMcpTools(await mcpReady);
          toolLists.set(req.accessToken, { tools: mcpTools, at: Date.now() });
        }
        const run: RunState = { budget: req.budget, spent: 0, rounds: 0 };
        const tools = buildTools(mcpTools, mcpReady, run, req.signal);
        log(`${cached ? "reused" : "listed"} ${mcpTools.length} mcp tools in ${since(t)}, model ${MODEL}`);

        const system = `${SYSTEM_PROMPT}\n\nTurn context\n${turnContext(req)}`;
        let modelMessages: ModelMessage[] = await convertToModelMessages(messages, {
          tools,
          ignoreIncompleteToolCalls: true,
        });
        const toolStartedAt: Record<string, number> = {};
        const metadata = (extra: { finishedAt?: number } = {}) => ({
          startedAt: runStart,
          toolStartedAt: { ...toolStartedAt },
          model: modelLabel(),
          ...extra,
        });

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          const guard = { leaked: false, runaway: false };
          let stepStart = Date.now();
          const result = streamText({
            model: openrouter(MODEL),
            system,
            messages: modelMessages,
            tools,
            stopWhen: stepCountIs(MAX_STEPS),
            maxOutputTokens: 6000,
            abortSignal: req.signal,
            experimental_transform: [guardTransform(guard), paceStream()],
            prepareStep: ({ stepNumber }) => {
              stepStart = Date.now();
              status(stepNumber === 0 && attempt === 0 ? "Thinking…" : "Reading the results…");
              return undefined;
            },
            onStepFinish: (step) => {
              log(
                `model step done in ${since(stepStart)} finish=${step.finishReason} in=${step.usage.inputTokens ?? "?"} out=${step.usage.outputTokens ?? "?"}`,
              );
            },
          });

          writer.merge(
            result.toUIMessageStream({
              sendStart: attempt === 0,
              sendFinish: false,
              sendReasoning: true,
              messageMetadata: ({ part }) => {
                if (part.type === "start") return metadata();
                if (part.type === "tool-call") {
                  toolStartedAt[part.toolCallId] = Date.now();
                  return metadata();
                }
                return undefined;
              },
              onError: (err) => friendlyError(err),
            }),
          );

          const steps = await result.steps;
          if (!guard.leaked && !guard.runaway) {
            const last = steps.at(-1);
            if (steps.length >= MAX_STEPS && last?.finishReason === "tool-calls") {
              log(`hit the ${MAX_STEPS}-step limit`);
              writer.write({
                type: "data-notice",
                data: {
                  text: `Stopped after ${MAX_STEPS} steps without a final answer. What's on the board so far is kept; ask a narrower follow-up to finish.`,
                },
              });
            }
            break;
          }

          log(`attempt ${attempt + 1} ${guard.leaked ? "wrote a tool call as text" : "had a runaway tool call"}, retrying`);
          if (attempt === MAX_ATTEMPTS - 1) {
            writer.write({
              type: "data-notice",
              data: { text: "The model kept producing malformed tool calls. Try again, or switch AGENT_MODEL." },
            });
            break;
          }
          const response = await result.response;
          modelMessages = [...modelMessages, ...answeredOnly(response.messages), { role: "user", content: NUDGE }];
        }

        // A connection that failed for auth reasons ends the turn with "sign in again".
        const failed = await mcpReady.then(() => null, (err: unknown) => err);
        if (failed instanceof McpAuthError) throw failed;
        log(`run finished, spent $${run.spent.toFixed(3)}`);
        writer.write({ type: "finish", messageMetadata: metadata({ finishedAt: Date.now() }) });
      } finally {
        const mcp = await mcpReady.catch(() => null);
        await mcp?.close().catch(() => {});
      }
    },
  });

  return createUIMessageStreamResponse({ stream: stream.pipeThrough(compactToolOutputs()) });
}

function friendlyError(err: unknown) {
  if (err instanceof McpAuthError) return "Your Composio session expired. Sign in again.";
  if (err instanceof ConfigError) return err.message;
  const message = err instanceof Error ? err.message : String(err);
  console.error("[agent]", err);
  if (/\b401\b|unauthori[sz]ed|invalid api key/i.test(message)) return "The model provider rejected the API key.";
  if (/\b429\b|rate limit/i.test(message)) return "The model is rate limited right now. Try again in a moment.";
  return message.slice(0, 300) || "Something went wrong.";
}

/**
 * Holds back text that could be tool-call markup (some open models write tool
 * calls as text) and watches tool arguments for runaway generation. Either
 * one stops the generation so the turn can be retried with a nudge.
 */
function guardTransform(state: { leaked: boolean; runaway: boolean }): StreamTextTransform<ToolSet> {
  return ({ stopStream }) => {
    const texts = new Map<string, TextGuard>();
    const replies = new Map<string, string>();
    const inputs = new Map<string, string>();
    return new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
      transform(chunk, controller) {
        if (chunk.type === "text-delta") {
          let guard = texts.get(chunk.id);
          if (!guard) {
            guard = new TextGuard();
            texts.set(chunk.id, guard);
          }
          const shownBefore = guard.shown;
          const out = guard.push(chunk.text);
          const sofar = (replies.get(chunk.id) ?? "") + chunk.text;
          replies.set(chunk.id, sofar);
          if (isRunaway(sofar, MAX_REPLY_CHARS)) {
            state.runaway = true;
            stopStream();
            return;
          }
          if (out.show) controller.enqueue({ ...chunk, text: out.show });
          if (out.retract !== undefined) {
            const tail = out.retract.slice(shownBefore);
            if (tail) controller.enqueue({ ...chunk, text: tail });
            state.leaked = true;
            stopStream();
          }
          return;
        }
        if (chunk.type === "text-end") {
          const rest = texts.get(chunk.id)?.flush();
          if (rest) controller.enqueue({ type: "text-delta", id: chunk.id, text: rest });
        }
        if (chunk.type === "tool-input-delta") {
          const json = (inputs.get(chunk.id) ?? "") + chunk.delta;
          inputs.set(chunk.id, json);
          if (isRunaway(json)) {
            state.runaway = true;
            stopStream();
            return;
          }
        }
        controller.enqueue(chunk);
      },
    });
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fast open models deliver a whole paragraph in one burst, which reads as the
 * answer popping in. Pace text out word by word (reasoning a few words at a
 * time) so it visibly types; a stream slower than the pace passes through
 * untouched.
 */
function paceStream(): StreamTextTransform<ToolSet> {
  return () => {
    let last = 0;
    return new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
      async transform(chunk, controller) {
        if (chunk.type !== "text-delta" && chunk.type !== "reasoning-delta") {
          controller.enqueue(chunk);
          return;
        }
        const words = chunk.text.match(/\s*\S+\s*/g) ?? [chunk.text];
        const reasoning = chunk.type === "reasoning-delta";
        const per = reasoning ? 3 : 1;
        const gapMs = reasoning ? 8 : 9;
        for (let i = 0; i < words.length; i += per) {
          const wait = last + gapMs - Date.now();
          if (wait > 0) await sleep(wait);
          controller.enqueue({ ...chunk, text: words.slice(i, i + per).join("") });
          last = Date.now();
        }
      },
    });
  };
}

/** Drops tool calls that never got a result, so a retry starts from a valid history. */
function answeredOnly(messages: ModelMessage[]): ModelMessage[] {
  const answered = new Set<string>();
  for (const m of messages) {
    if (m.role === "tool") for (const part of m.content) if (part.type === "tool-result") answered.add(part.toolCallId);
  }
  return messages
    .map((m) =>
      m.role === "assistant" && Array.isArray(m.content)
        ? { ...m, content: m.content.filter((p) => p.type !== "tool-call" || answered.has(p.toolCallId)) }
        : m,
    )
    .filter((m) => !(m.role === "assistant" && Array.isArray(m.content) && m.content.length === 0));
}

/** The browser gets statuses, entities and short previews; full outputs stay on the server. */
function compactToolOutputs() {
  return new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      controller.enqueue(
        chunk.type === "tool-output-available" ? { ...chunk, output: compactOutput(chunk.output) } : chunk,
      );
    },
  });
}

function turnContext(req: AgentRequest) {
  const lines = [
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
    `Spending cap for this request: ${formatUsd(req.budget, 2)} in Instant charges${
      req.budget === 0 ? " (free tools only)" : ""
    }. Spent earlier in this session: ${formatUsd(req.spentBefore)}.`,
  ];
  if (req.revealed.length) {
    lines.push("Contacts the user has already revealed from the board:");
    for (const r of req.revealed.slice(0, 40)) {
      lines.push(
        `- ${r.name}${r.title ? `, ${r.title}` : ""}${r.company ? ` at ${r.company}` : ""}${
          r.email ? ` <${r.email}>${r.status ? ` (${r.status})` : ""}` : ""
        }`,
      );
    }
  }
  return lines.join("\n");
}

function buildTools(mcpTools: McpTool[], mcp: Promise<Client>, run: RunState, signal: AbortSignal): ToolSet {
  const tools: ToolSet = {};
  const exposed = mcpTools
    .filter((t) => (MCP_TOOL_NAMES as readonly string[]).includes(t.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const t of exposed) {
    const schema: Record<string, unknown> = { ...t.inputSchema };
    delete schema.$schema;
    tools[t.name] = tool({
      description: t.description ?? "",
      inputSchema: jsonSchema<Record<string, unknown>>({ type: "object", ...schema }),
      execute: (input) => runMcpTool(t.name, (input ?? {}) as Record<string, unknown>, mcp, run, signal),
      toModelOutput: ({ output }) => ({ type: "text", value: modelText(output as McpToolOutput) }),
    });
  }
  return tools;
}

function modelText(output: McpToolOutput) {
  if (!output.successful) return `Error: ${output.error ?? "the tool call failed"}`;
  return `${output.text ?? ""}${output.nudge ? `\n\n${output.nudge}` : ""}`;
}

function capText(text: string) {
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS)}\n…[truncated ${text.length - MAX_RESULT_CHARS} characters of tool output]`;
}

/** Runs one Composio meta tool. Never throws: failures come back as `{ successful: false }`. */
async function runMcpTool(
  name: string,
  args: Record<string, unknown>,
  mcpReady: Promise<Client>,
  run: RunState,
  signal: AbortSignal,
): Promise<McpToolOutput> {
  const started = Date.now();
  const steps = describeSteps(name, args, prices);
  const refuse = (error: string): McpToolOutput => {
    console.log(`[agent] refused ${name}: ${error.slice(0, 120)}`);
    return { successful: false, blocked: true, error, durationMs: 0, charge: 0 };
  };

  let nudge: string | undefined;
  if (name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
    const meta = steps.filter((s) => s.slug.startsWith("COMPOSIO_"));
    if (meta.length) {
      return refuse(
        `${meta.map((s) => s.slug).join(", ")} isn't available in this app. There is no workbench; read the earlier tool results directly.`,
      );
    }
    if (!steps.length) {
      // Doesn't count against the research budget: nothing ran.
      return refuse(
        "This batch had no tools, so nothing ran. Pass tools: [{ tool_slug, arguments }] using the slugs from COMPOSIO_SEARCH_TOOLS.",
      );
    }
    run.rounds += 1;
    if (run.rounds > RESEARCH_LIMIT) {
      return refuse(
        "Research budget for this request is used up. Don't search again: write your final shortlist as a people or jobs block and reply.",
      );
    }
    const blocked = budgetBlock(steps, run);
    if (blocked) return refuse(blocked);
    if (run.rounds >= RESEARCH_NUDGE_AT) {
      nudge = `(Research check: ${run.rounds} rounds of tool calls so far. Unless something essential is missing, stop searching: write your final shortlist as a people or jobs block and reply.)`;
    }
  }

  try {
    // Results inline, so the model never needs a workbench to read them.
    const callArgs =
      name === "COMPOSIO_MULTI_EXECUTE_TOOL" ? { ...args, sync_response_to_workbench: false } : args;
    const result = await callMcpTool(await mcpReady, name, callArgs, signal);
    const charge = instantCharge(result.json);
    run.spent += charge;
    console.log(
      `[agent] tool ${name}${name === "COMPOSIO_MULTI_EXECUTE_TOOL" ? ` (${steps.map((s) => s.slug).join(", ")})` : ""} took ${since(started)}, ${result.text.length} chars`,
    );

    let found: { people: Person[]; companies: Company[] } = { people: [], companies: [] };
    let stepResults: StepResult[] = [];
    let newPrices: Record<string, Price> | undefined;
    let toolkits: string[] | undefined;

    if (name === "COMPOSIO_SEARCH_TOOLS") {
      newPrices = pricesFromSearch(result.json);
      Object.assign(prices, newPrices);
      toolkits = searchToolkits(result.json);
      stepResults = [{ index: 0, ok: !result.isError, summary: toolkits.join(" · ") || undefined }];
    } else if (name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
      ({ found, stepResults } = readBatch(result.json, steps));
    } else {
      stepResults = [{ index: 0, ok: !result.isError }];
    }

    const failed = stepResults.length > 0 && stepResults.every((s) => !s.ok);
    return {
      successful: !result.isError && !failed,
      error: result.isError ? firstLine(result.text) : failed ? stepResults[0]?.error : undefined,
      durationMs: Date.now() - started,
      charge,
      steps: stepResults,
      people: found.people,
      companies: found.companies,
      prices: newPrices,
      toolkits,
      nudge,
      text: capText(result.text),
    };
  } catch (err) {
    const message =
      err instanceof McpAuthError
        ? "Your Composio session expired."
        : signal.aborted
          ? "Stopped."
          : err instanceof Error
            ? err.message
            : "Tool call failed";
    return { successful: false, error: message, durationMs: Date.now() - started, charge: 0 };
  }
}

function isInstantToolkit(toolkit: string) {
  return Object.keys(prices).some((slug) => toolkitOf(slug) === toolkit);
}

function budgetBlock(steps: StepInfo[], run: RunState): string | null {
  // Unpriced tools from non-Instant toolkits run on the user's own connections.
  const paid = steps.filter((s) => (s.price ? !s.price.free : isInstantToolkit(s.toolkit)));
  if (paid.length === 0) return null;
  // Worst case: the top of each price range, times the items the call asks for.
  const lines = paid.map((s) => ({ step: s, est: estimateStep(s) }));
  const unpriced = lines.some((l) => !l.est);
  const estimate = lines.reduce((sum, l) => sum + (l.est?.max ?? 0), 0);
  const over = run.budget === 0 || unpriced || run.spent + estimate > run.budget + 1e-9;
  if (!over) return null;
  console.log(`[agent] spend cap blocked: ${steps.map((s) => s.slug).join(", ")}`);
  const list = lines
    .map(({ step, est }) =>
      est
        ? `${step.slug} (${formatRange(est.min, est.max)}${est.qty > 1 ? ` for ${est.qty} items` : ""})`
        : `${step.slug} (price unknown)`,
    )
    .join("; ");
  return `Blocked by the user's spending cap of ${formatUsd(run.budget, 2)} for this request (${formatUsd(
    run.spent,
  )} spent so far; this batch could cost up to ${formatUsd(estimate)}). Paid tools in the batch: ${list}. Don't retry as is: ask for fewer results, or present what you have and tell the user they can raise the cap in the composer or reveal contacts one by one from the board.`;
}

function readBatch(json: unknown, steps: StepInfo[]) {
  const results = (json as { data?: { results?: unknown[] } })?.data?.results;
  const people = new Map<string, Person>();
  const companies = new Map<string, Company>();
  const stepResults: StepResult[] = [];

  if (!Array.isArray(results)) {
    const err = (json as { error?: unknown })?.error;
    return {
      found: { people: [], companies: [] },
      stepResults: steps.map((s) => ({
        index: s.index,
        ok: false,
        error: typeof err === "string" ? err : "No results returned",
      })),
    };
  }

  results.forEach((r, i) => {
    const item = r as {
      index?: number;
      tool_slug?: string;
      response?: { successful?: boolean; data?: unknown; error?: unknown };
      error?: unknown;
    };
    const index = typeof item.index === "number" ? item.index : i;
    const slug = item.tool_slug ?? steps[index]?.slug ?? "UNKNOWN";
    const response = item.response ?? {};
    const error = response.error ?? item.error;
    const ok = response.successful !== false && !error;
    const found = ok ? extractEntities(response.data, toolkitOf(slug)) : { people: [], companies: [] };
    for (const p of found.people) people.set(p.key, mergePerson(people.get(p.key), p));
    for (const c of found.companies) companies.set(c.key, mergeCompany(companies.get(c.key), c));
    stepResults.push({
      index,
      ok,
      error: ok ? undefined : firstLine(typeof error === "string" ? error : JSON.stringify(error)),
      summary: ok ? summarize(found.people.length, found.companies.length) : undefined,
      raw: JSON.stringify(response, null, 2).slice(0, 8000),
    });
  });

  return {
    found: { people: [...people.values()], companies: [...companies.values()] },
    stepResults,
  };
}

function summarize(people: number, companies: number) {
  const parts = [];
  if (people) parts.push(`${people} ${people === 1 ? "person" : "people"}`);
  if (companies) parts.push(`${companies} ${companies === 1 ? "company" : "companies"}`);
  return parts.length ? parts.join(", ") : "No matches";
}

function searchToolkits(json: unknown): string[] {
  const statuses = (json as { data?: { toolkit_connection_statuses?: Array<{ toolkit?: string }> } })?.data
    ?.toolkit_connection_statuses;
  return Array.isArray(statuses)
    ? statuses.map((s) => s.toolkit).filter((t): t is string => Boolean(t))
    : [];
}

function firstLine(text: string) {
  return text.split("\n")[0].slice(0, 240);
}
