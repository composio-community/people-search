"use client";

import { useState } from "react";
import { AlertTriangle, Brain, ChevronRight, X } from "lucide-react";
import { Streamdown } from "streamdown";
import { formatPrice, formatRange, formatUsd, toolkitName } from "@/lib/catalog";
import { describeSteps, estimateStep, toolChipLabel } from "@/lib/steps";
import type { Price } from "@/lib/types";
import type { McpToolOutput } from "@/lib/ui-message";
import { useNow } from "@/lib/use-now";
import { toolName, type GroupItem, type ToolPart } from "./chat-state";
import { ComposioMark } from "./logos";
import { cx, ProviderLogo } from "./ui";

type Loose = Record<string, unknown>;
type Phase = "running" | "done" | "error" | "blocked" | "interrupted";

const DONE_STATES = new Set(["output-available", "output-error", "output-denied"]);
const isPending = (part: ToolPart) => !DONE_STATES.has(part.state);

function outputOf(part: ToolPart) {
  return part.state === "output-available" ? (part.output as McpToolOutput | undefined) : undefined;
}

function phaseOf(part: ToolPart, live: boolean): Phase {
  if (isPending(part)) return live ? "running" : "interrupted";
  if (part.state !== "output-available") return "error";
  const out = outputOf(part);
  if (out && !out.successful) return out.blocked ? "blocked" : "error";
  return "done";
}

function formatSeconds(ms: number) {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function toolkitsOf(part: ToolPart, prices: Record<string, Price>) {
  const name = toolName(part);
  if (name === "COMPOSIO_SEARCH_TOOLS" || name === "COMPOSIO_GET_TOOL_SCHEMAS") return ["composio"];
  return [...new Set(describeSteps(name, part.input as Loose, prices).map((s) => s.toolkit))].filter(
    (t) => t !== "composio",
  );
}

/** Wall time covered by a group's tool calls (overlapping calls count once). */
function groupTiming(
  tools: ToolPart[],
  starts: Record<string, number>,
  live: boolean,
  now: number | null,
  seenAt: number,
) {
  let running = false;
  let complete = tools.length > 0;
  const intervals: Array<[number, number]> = [];
  for (const t of tools) {
    const active = live && isPending(t);
    running ||= active;
    const duration = outputOf(t)?.durationMs;
    const start = active ? seenAt : (starts[t.toolCallId] ?? seenAt);
    const end = active
      ? start !== undefined && now !== null
        ? Math.max(start, now)
        : null
      : start !== undefined && typeof duration === "number"
        ? start + duration
        : null;
    if (start === undefined || end === null) {
      complete = false;
      continue;
    }
    intervals.push([start, end]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let reach = -Infinity;
  for (const [s, e] of intervals) {
    total += Math.max(0, e - Math.max(s, reach));
    reach = Math.max(reach, e);
  }
  return { running, durationMs: complete ? total : null };
}

/** Composio's dot-matrix activity indicator. */
export function DotMatrix({
  state = "loading",
  className,
  label,
}: {
  state?: "thinking" | "searching" | "connecting" | "loading";
  className?: string;
  /** Announced to screen readers; without it the indicator is decorative. */
  label?: string;
}) {
  const delay = (r: number, c: number) =>
    state === "thinking"
      ? (r + c) * 120
      : state === "searching"
        ? c * 170
        : state === "connecting"
          ? (Math.abs(1 - r) + Math.abs(1 - c)) * 160
          : (((r * 3 + c) * 5) % 9) * 95;
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx("inline-grid shrink-0 grid-cols-3 gap-[2px] text-fg", className)}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          className="h-[3px] w-[3px] rounded-full bg-current"
          style={{ animation: "dm-pulse 1.2s ease-in-out infinite", animationDelay: `${delay(Math.floor(i / 3), i % 3)}ms` }}
        />
      ))}
    </span>
  );
}

/**
 * One run of reasoning and tool calls. A single step renders inline; longer
 * runs sit under "Working · 12s" / "Worked for 12s" like the playground.
 */
export function TimelineGroup({
  items,
  starts,
  live,
  current,
  prices,
}: {
  items: GroupItem[];
  starts: Record<string, number>;
  /** The message is still streaming. */
  live: boolean;
  /** This group holds the newest part of a streaming message. */
  current: boolean;
  prices: Record<string, Price>;
}) {
  // Open while it's the step being worked on, so reasoning and tool calls
  // stream in view; folds to "Worked for Xs" once the answer starts.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? current;
  const [seenAt] = useState(() => Date.now());
  const tools = items.flatMap((i) => (i.kind === "tool" ? [i.part] : []));
  const lastItem = items.at(-1);
  const pendingTools = live && tools.some(isPending);
  const now = useNow(pendingTools);
  // Server start times anchor finished calls; live ones are measured from first sight.
  const timing = groupTiming(tools, starts, live, now === null ? null : Math.max(now, seenAt), seenAt);
  const streaming = current && (lastItem?.kind === "reasoning" ? lastItem.streaming : timing.running);

  if (items.length === 1 && lastItem) {
    return (
      <div className="my-1">
        <Item item={lastItem} starts={starts} live={live} prices={prices} inGroup={false} />
      </div>
    );
  }

  const logos = [...new Set(tools.flatMap((t) => toolkitsOf(t, prices)))];
  const currentLabel =
    streaming && lastItem
      ? lastItem.kind === "tool"
        ? toolChipLabel(toolName(lastItem.part), lastItem.part.input as Loose)
        : "Thinking"
      : null;
  const indicator =
    lastItem?.kind === "reasoning"
      ? "thinking"
      : lastItem?.kind === "tool" && toolName(lastItem.part).includes("SEARCH")
        ? "searching"
        : "loading";
  const label = tools.length
    ? `${streaming ? "Working" : "Worked"}${
        timing.durationMs !== null ? `${streaming ? " · " : " for "}${formatSeconds(timing.durationMs)}` : ""
      }`
    : streaming
      ? "Thinking"
      : "Thought";

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        className="group flex min-h-10 max-w-full items-center gap-2 rounded-[6px] text-left text-[15px] text-fg-2 transition-colors hover:text-fg"
      >
        {streaming && !open && <DotMatrix state={indicator} />}
        <span className="shrink-0 tabular">{label}</span>
        {!open && logos.length > 0 && (
          <span className="flex shrink-0 items-center gap-1">
            {logos.slice(0, 5).map((t) =>
              t === "composio" ? (
                <span key={t} className="grid h-[18px] w-[18px] place-items-center rounded-[5px] bg-fg text-bg">
                  <ComposioMark className="h-2.5 w-2.5" />
                </span>
              ) : (
                <ProviderLogo key={t} toolkit={t} size={18} />
              ),
            )}
          </span>
        )}
        {!open && currentLabel && <span className="min-w-0 truncate text-[13.5px] text-fg-3">{currentLabel}</span>}
        <ChevronRight className={cx("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-90")} />
      </button>
      <div className={cx("grid transition-[grid-template-rows] duration-200 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="min-h-0 overflow-hidden">
          {open && (
            <div className="ml-1.5 border-l border-line pb-2 pl-4">
              {items.map((item) => (
                <Item
                  key={item.kind === "tool" ? item.part.toolCallId : item.id}
                  item={item}
                  starts={starts}
                  live={live}
                  prices={prices}
                  inGroup
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Item({
  item,
  starts,
  live,
  prices,
  inGroup,
}: {
  item: GroupItem;
  starts: Record<string, number>;
  live: boolean;
  prices: Record<string, Price>;
  inGroup: boolean;
}) {
  if (item.kind === "reasoning") return <ReasoningStep text={item.text} streaming={item.streaming} inGroup={inGroup} />;
  return <ToolChip part={item.part} startedAt={starts[item.part.toolCallId]} live={live} prices={prices} />;
}

/**
 * Short reasoning inside a group is one muted line. Longer reasoning shows a
 * live preview pinned to the newest line while it streams, then folds away
 * under "Reasoning", as in Composio Bench.
 */
function ReasoningStep({ text, streaming, inGroup }: { text: string; streaming: boolean; inGroup: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const clean = text.trim();
  if (inGroup && clean.length <= 240) {
    return (
      <div className="flex min-h-9 items-start gap-2 py-1.5">
        {streaming && <DotMatrix state="thinking" className="mt-1.5" />}
        <p className="text-[13.5px] leading-5 text-fg-3">{clean}</p>
      </div>
    );
  }
  const expanded = open ?? streaming;
  const preview = streaming && open === null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        className="flex min-h-9 items-center gap-2 text-[14px] text-fg-3 transition-colors hover:text-fg"
      >
        {streaming ? <DotMatrix state="thinking" /> : <Brain className="h-4 w-4" strokeWidth={1.75} />}
        <span className={cx(streaming && "shimmer-text")}>{streaming ? "Thinking" : "Reasoning"}</span>
        <ChevronRight className={cx("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
      </button>
      <div
        className={cx(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          {/* column-reverse keeps the preview scrolled to the newest line as it grows */}
          <div
            className={cx(
              "flex flex-col-reverse overflow-y-auto pb-3 pl-6",
              preview ? "max-h-36 [mask-image:linear-gradient(to_bottom,transparent,#000_28px)]" : "max-h-[420px]",
            )}
          >
            <div className="ps-markdown ps-reasoning text-[13.5px] leading-6 text-fg-3">
              <Streamdown isAnimating={streaming} animated={streaming ? REASONING_ANIMATION : undefined}>
                {clean}
              </Streamdown>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const REASONING_ANIMATION = { animation: "fadeIn", duration: 200, sep: "word" } as const;

/** A tool call: spinner and live seconds while running, label from its input, details on click. */
function ToolChip({
  part,
  startedAt,
  live,
  prices,
}: {
  part: ToolPart;
  startedAt?: number;
  live: boolean;
  prices: Record<string, Price>;
}) {
  const [open, setOpen] = useState(false);
  // Live seconds count from when the call appeared here, so a server/browser
  // clock difference can't skew them; the final duration comes from the server.
  const [seenAt] = useState(() => Date.now());
  void startedAt;
  const name = toolName(part);
  const input = part.input as Loose | undefined;
  const out = outputOf(part);
  const phase = phaseOf(part, live);
  const now = useNow(phase === "running");
  const elapsed =
    phase === "running"
      ? now !== null
        ? Math.max(0, now - seenAt)
        : null
      : typeof out?.durationMs === "number" && out.durationMs > 0
        ? out.durationMs
        : null;
  const toolkits = toolkitsOf(part, prices);
  const error =
    part.state === "output-error" ? (part as { errorText?: string }).errorText : out && !out.successful ? out.error : undefined;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="group flex min-h-9 w-full max-w-full items-center gap-2.5 text-left"
      >
        <span className="relative grid h-5 w-5 shrink-0 place-items-center">
          {phase === "running" ? (
            <span className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-fg-4 border-t-fg" />
          ) : toolkits[0] === "composio" || !toolkits.length ? (
            <span className="grid h-5 w-5 place-items-center rounded-[5px] bg-fg text-bg">
              <ComposioMark className="h-3 w-3" />
            </span>
          ) : (
            <ProviderLogo toolkit={toolkits[0]} size={20} />
          )}
          {(phase === "error" || phase === "blocked" || phase === "interrupted") && (
            <span
              className={cx(
                "absolute -right-1 -bottom-1 grid h-3 w-3 place-items-center rounded-full ring-2 ring-bg",
                phase === "error" ? "bg-danger text-white" : "bg-warning text-white",
              )}
            >
              {phase === "error" ? <X className="h-2 w-2" strokeWidth={3.5} /> : <AlertTriangle className="h-2 w-2" strokeWidth={3} />}
            </span>
          )}
        </span>
        <span
          className={cx(
            "min-w-0 truncate text-[14px]",
            phase === "running" ? "text-fg-2" : "text-fg-2 group-hover:text-fg",
          )}
        >
          {toolChipLabel(name, input)}
        </span>
        {toolkits.length > 1 && (
          <span className="flex shrink-0 -space-x-1">
            {toolkits.slice(1, 4).map((t) => (
              <ProviderLogo key={t} toolkit={t} size={16} />
            ))}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[11px] text-fg-3">
          {phase === "interrupted" && <span className="text-warning">Interrupted</span>}
          {phase === "blocked" && <span className="text-warning">Blocked</span>}
          {out && out.charge > 0 && <span className="rounded-[4px] bg-hover px-1.5 py-px text-fg">{formatUsd(out.charge)}</span>}
          {elapsed !== null && <span className="tabular">{formatSeconds(elapsed)}</span>}
          <ChevronRight className={cx("h-3 w-3 transition-transform", open && "rotate-90")} />
        </span>
      </button>
      {phase === "error" && error && !open && (
        <p className="mb-1 ml-[30px] truncate font-mono text-[11px] text-danger">{error}</p>
      )}
      {open && <ChipDetails name={name} input={input} out={out} error={error} prices={prices} />}
    </div>
  );
}

function argSummary(args: Loose) {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args ?? {})) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    const key = k.replace(/^q_/, "").replace(/_/g, " ");
    const val = Array.isArray(v)
      ? v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ")
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);
    parts.push(k === "use_cases" ? val : `${key}: ${val}`);
  }
  return parts.join(" · ") || "no arguments";
}

function ChipDetails({
  name,
  input,
  out,
  error,
  prices,
}: {
  name: string;
  input?: Loose;
  out?: McpToolOutput;
  error?: string;
  prices: Record<string, Price>;
}) {
  const steps = describeSteps(name, input, { ...prices, ...(out?.prices ?? {}) });
  return (
    <div className="mb-2 ml-[30px] overflow-hidden rounded-[8px] bg-card shadow-[inset_0_0_0_1px_var(--line)]">
      {error && <p className="border-b border-line px-3 py-2 text-[12.5px] leading-5 text-fg-2">{error}</p>}
      {name === "COMPOSIO_SEARCH_TOOLS" && out?.toolkits?.length ? (
        <p className="border-b border-line px-3 py-2 font-mono text-[11px] text-fg-3">
          Found: {out.toolkits.map(toolkitName).join(" · ")}
        </p>
      ) : null}
      {steps.map((step) => {
        const result = out?.steps?.find((s) => s.index === step.index);
        // Unit price × the items the call asks for; the charge it actually ran up shows on the chip.
        const estimate = estimateStep(step);
        const price =
          estimate && estimate.qty > 1
            ? `${formatPrice(step.price)} × ${estimate.guessedQty ? "up to " : ""}${estimate.qty} = ${formatRange(estimate.min, estimate.max)}`
            : formatPrice(step.price);
        return (
          <div key={step.index} className="border-b border-line px-3 py-2 last:border-b-0">
            <div className="flex items-center gap-2">
              {step.toolkit === "composio" ? (
                <span className="grid h-4 w-4 place-items-center rounded-[4px] bg-fg text-bg">
                  <ComposioMark className="h-2.5 w-2.5" />
                </span>
              ) : (
                <ProviderLogo toolkit={step.toolkit} size={16} />
              )}
              <span className="min-w-0 truncate text-[13px] text-fg">
                {step.toolkit === "composio" ? step.label : `${toolkitName(step.toolkit)} · ${step.label}`}
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[10.5px] text-fg-3">
                {result?.summary && <span className="text-fg-2">{result.summary}</span>}
                {price && step.toolkit !== "composio" && (
                  <span className="rounded-[4px] px-1.5 py-px uppercase shadow-[inset_0_0_0_1px_var(--line)]" title={step.price?.text}>
                    {price}
                  </span>
                )}
              </span>
            </div>
            <p className="mt-0.5 truncate font-mono text-[11px] text-fg-3">
              {result?.ok === false && result.error ? <span className="text-danger">{result.error}</span> : argSummary(step.args)}
            </p>
            {result?.raw && (
              <details className="mt-1">
                <summary className="mono-label cursor-pointer text-fg-4 hover:text-fg">Response</summary>
                <pre className="mt-1 max-h-[240px] overflow-auto font-mono text-[11px] leading-5 text-fg-2">{result.raw}</pre>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
