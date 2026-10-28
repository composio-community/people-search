import { getToolName, isToolUIPart } from "ai";
import { closedBoardBlocks, parseBoardBlock, type BoardBlock } from "@/lib/blocks";
import { KNOWN_PRICES } from "@/lib/catalog";
import {
  findSimilarPerson,
  mergeCompany,
  mergePerson,
  resolveCompanyRef,
  resolvePersonRef,
} from "@/lib/entities";
import { presentPicks } from "@/lib/present";
import type {
  Company,
  Person,
  Price,
  RevealAttempt,
  RevealEvent,
  RevealMode,
} from "@/lib/types";
import type { AgentUIMessage, McpToolOutput } from "@/lib/ui-message";

export type MessagePart = AgentUIMessage["parts"][number];
export type ToolPart = Extract<MessagePart, { toolCallId: string }>;

/* ------------------------------------------------------------------ */
/* UI state: everything that isn't in the chat messages themselves.     */
/* ------------------------------------------------------------------ */

export type UIState = {
  chatId: string;
  revealing: Record<string, RevealMode>;
  revealErrors: Record<string, string>;
  /** Providers tried for each person's latest reveal, in order. */
  revealTrail: Record<string, RevealAttempt[]>;
  /** What reveals learned, layered over the people the agent found. */
  patches: Record<string, Partial<Person>>;
  revealSpent: number;
  /** Tool charges from earlier chats, so starting a new chat doesn't lose them from "Spent". */
  carriedSpent: number;
  lastReveal?: { amount: number; at: number };
  saved: string[];
  budget: number;
  openPerson: string | null;
  listOpen: boolean;
  authExpired: boolean;
  /** Transient server status ("Connecting to Composio…") until parts arrive. */
  phase: string | null;
};

/** The part of the UI state that survives a reload (saved per user on the server). */
export type PersistedUI = Pick<
  UIState,
  "chatId" | "patches" | "revealTrail" | "revealErrors" | "revealSpent" | "carriedSpent" | "saved" | "budget"
>;

export function toPersisted(s: UIState): PersistedUI {
  return {
    chatId: s.chatId,
    patches: s.patches,
    revealTrail: s.revealTrail,
    revealErrors: s.revealErrors,
    revealSpent: s.revealSpent,
    carriedSpent: s.carriedSpent,
    saved: s.saved,
    budget: s.budget,
  };
}

export function initialUI(chatId: string, saved?: Partial<PersistedUI> | null): UIState {
  return {
    chatId,
    revealing: {},
    revealErrors: saved?.revealErrors ?? {},
    revealTrail: saved?.revealTrail ?? {},
    patches: saved?.patches ?? {},
    revealSpent: saved?.revealSpent ?? 0,
    carriedSpent: saved?.carriedSpent ?? 0,
    saved: saved?.saved ?? [],
    budget: saved?.budget ?? 0.25,
    openPerson: null,
    listOpen: false,
    authExpired: false,
    phase: null,
  };
}

export type Action =
  | { type: "reveal-start"; keys: string[]; mode: RevealMode }
  | { type: "reveal-event"; event: RevealEvent; at: number }
  | { type: "reveal-fail"; keys: string[]; error: string }
  | { type: "toggle-save"; key: string }
  | { type: "save-many"; keys: string[] }
  | { type: "unsave-all" }
  | { type: "open-person"; key: string | null }
  | { type: "list"; open: boolean }
  | { type: "budget"; value: number }
  | { type: "phase"; text: string | null }
  | { type: "auth-expired" }
  | { type: "new-chat"; chatId: string; carried: number };

export function reducer(state: UIState, action: Action): UIState {
  switch (action.type) {
    case "reveal-start": {
      const revealing = { ...state.revealing };
      const revealErrors = { ...state.revealErrors };
      const revealTrail = { ...state.revealTrail };
      for (const k of action.keys) {
        revealing[k] = action.mode;
        delete revealErrors[k];
        revealTrail[k] = [];
      }
      return { ...state, revealing, revealErrors, revealTrail };
    }

    case "reveal-event": {
      const e = action.event;
      if (e.type === "attempt") {
        const trail = [...(state.revealTrail[e.key] ?? [])];
        const i = trail.findIndex((a) => a.slug === e.attempt.slug);
        if (i === -1) trail.push(e.attempt);
        else trail[i] = e.attempt;
        const charge = e.attempt.charge ?? 0;
        const patch = state.patches[e.key] ?? {};
        return {
          ...state,
          revealTrail: { ...state.revealTrail, [e.key]: trail },
          revealSpent: state.revealSpent + charge,
          lastReveal: charge > 0 ? { amount: charge, at: action.at } : state.lastReveal,
          patches:
            charge > 0
              ? { ...state.patches, [e.key]: { ...patch, spent: (patch.spent ?? 0) + charge } }
              : state.patches,
        };
      }
      if (e.type === "person") {
        const revealing = { ...state.revealing };
        delete revealing[e.key];
        const revealErrors = { ...state.revealErrors };
        if (e.ok) delete revealErrors[e.key];
        else revealErrors[e.key] = e.error ?? "No match";
        const prev = state.patches[e.key] ?? {};
        const patches = e.patch
          ? {
              ...state.patches,
              [e.key]: {
                ...prev,
                ...e.patch,
                sources: [...new Set([...(prev.sources ?? []), ...(e.patch.sources ?? [])])],
                spent: prev.spent,
              },
            }
          : state.patches;
        return { ...state, revealing, revealErrors, patches };
      }
      return state;
    }

    case "reveal-fail": {
      const revealing = { ...state.revealing };
      const revealErrors = { ...state.revealErrors };
      for (const k of action.keys) {
        delete revealing[k];
        revealErrors[k] = action.error;
      }
      return { ...state, revealing, revealErrors };
    }

    case "toggle-save":
      return {
        ...state,
        saved: state.saved.includes(action.key)
          ? state.saved.filter((k) => k !== action.key)
          : [...state.saved, action.key],
      };

    case "save-many":
      return { ...state, saved: [...new Set([...state.saved, ...action.keys])] };

    case "unsave-all":
      return { ...state, saved: [] };

    case "open-person":
      return { ...state, openPerson: action.key };

    case "list":
      return { ...state, listOpen: action.open };

    case "budget":
      return { ...state, budget: action.value };

    case "phase":
      return { ...state, phase: action.text };

    case "auth-expired":
      return { ...state, authExpired: true };

    case "new-chat":
      // Contacts, reveals, the saved list and the spend total carry over; the conversation starts fresh.
      return {
        ...state,
        chatId: action.chatId,
        carriedSpent: state.carriedSpent + action.carried,
        phase: null,
        openPerson: null,
      };
  }
}

/** Actions that change what a reload should restore. */
function changesSavedState(action: Action) {
  switch (action.type) {
    case "reveal-event":
      return action.event.type !== "attempt" || action.event.attempt.state !== "running";
    case "reveal-fail":
    case "toggle-save":
    case "save-many":
    case "unsave-all":
    case "budget":
    case "new-chat":
      return true;
    default:
      return false;
  }
}

/**
 * The UI state as a tiny external store (read with useSyncExternalStore), so
 * every change that should survive a reload is saved right where it happens,
 * from the dispatch itself, with no effect.
 */
export function createUIStore(initial: UIState, save: (state: PersistedUI) => void) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispatch(action: Action) {
      const next = reducer(state, action);
      if (next === state) return;
      state = next;
      for (const l of listeners) l();
      if (changesSavedState(action)) save(toPersisted(next));
    },
  };
}

/* ------------------------------------------------------------------ */
/* Derived from the messages.                                            */
/* ------------------------------------------------------------------ */

export type Store = {
  people: Record<string, Person>;
  companies: Record<string, Company>;
  prices: Record<string, Price>;
  toolSpent: number;
  lastToolCharge?: { id: string; amount: number };
};

export const toolName = (part: ToolPart) => getToolName(part as Parameters<typeof getToolName>[0]);

export function isPresent(part: ToolPart) {
  return toolName(part) === "present_results";
}

export function deriveStore(messages: AgentUIMessage[], patches: UIState["patches"]): Store {
  const people: Record<string, Person> = {};
  const companies: Record<string, Company> = {};
  const prices: Record<string, Price> = { ...KNOWN_PRICES };
  let toolSpent = 0;
  let lastToolCharge: Store["lastToolCharge"];
  const picked: ReturnType<typeof presentPicks>[] = [];

  for (const m of messages) {
    for (const part of m.parts) {
      if (part.type === "text" && m.role === "assistant") {
        for (const block of closedBoardBlocks(part.text)) picked.push(picksFromBlock(block.kind, block.board));
        continue;
      }
      if (!isToolUIPart(part)) continue;
      const tp = part as ToolPart;
      if (isPresent(tp)) {
        if (tp.state === "output-available" || tp.state === "input-available") picked.push(presentPicks(tp.input));
        continue;
      }
      if (tp.state !== "output-available") continue;
      const out = tp.output as McpToolOutput | undefined;
      if (!out) continue;
      toolSpent += out.charge ?? 0;
      if ((out.charge ?? 0) > 0) lastToolCharge = { id: tp.toolCallId, amount: out.charge };
      for (const p of out.people ?? []) people[p.key] = mergePerson(people[p.key], p);
      for (const c of out.companies ?? []) companies[c.key] = mergeCompany(companies[c.key], c);
      if (out.prices) Object.assign(prices, out.prices);
    }
  }

  // People the model listed that no tool returned join the store once the
  // board is final, so they can be revealed, saved and opened.
  for (const picks of picked) {
    for (const pick of picks.people) {
      const hit =
        resolvePersonRef(pick.ref, people) ?? people[pick.person.key] ?? findSimilarPerson(pick.person, people);
      if (!hit) people[pick.person.key] = pick.person;
    }
    for (const pick of picks.companies) {
      const hit = resolveCompanyRef(pick.ref, companies) ?? companies[pick.company.key];
      if (!hit) companies[pick.company.key] = pick.company;
    }
  }

  for (const [key, patch] of Object.entries(patches)) {
    const base = people[key];
    if (!base) continue;
    people[key] = { ...mergePerson(base, { ...patch, key }), spent: patch.spent };
  }

  return { people, companies, prices, toolSpent, lastToolCharge };
}

/* ------------------------------------------------------------------ */
/* Boards and message segments.                                          */
/* ------------------------------------------------------------------ */

export type BoardItem = {
  kind: "board";
  id: string;
  title: string;
  summary?: string;
  /** `inline` holds rows still being written that matched nothing in the store. */
  people: { key: string; note?: string; inline?: Person }[];
  companies: { key: string; note?: string; inline?: Company }[];
  pending?: boolean;
  streaming?: boolean;
};

function dedupe<T extends { key: string }>(list: T[]) {
  const seen = new Set<string>();
  return list.filter((x) => (seen.has(x.key) ? false : (seen.add(x.key), true)));
}

function picksFromBlock(kind: "people" | "companies", board: BoardBlock) {
  const rows = board.rows.map((r) => ({ ref: r.ref, name: r.name, note: r.note }));
  return presentPicks({
    title: board.title,
    summary: board.summary,
    people: kind === "people" ? rows : [],
    companies: kind === "companies" ? rows : [],
  });
}

/** A ```people or ```companies block in the reply as a board, live while it streams. */
export function boardFromBlock(
  kind: "people" | "companies",
  raw: string,
  open: boolean,
  id: string,
  store: Store,
): BoardItem {
  return boardFromPicks(picksFromBlock(kind, parseBoardBlock(raw)), id, open, store);
}

/** A present_results call (older turns) as a board. */
export function boardFromPart(part: ToolPart, store: Store): BoardItem {
  return boardFromPicks(presentPicks(part.input), part.toolCallId, part.state === "input-streaming", store);
}

function boardFromPicks(
  picks: ReturnType<typeof presentPicks>,
  id: string,
  streaming: boolean,
  store: Store,
): BoardItem {
  const people = picks.people.map((pick) => {
    const hit =
      resolvePersonRef(pick.ref, store.people) ??
      store.people[pick.person.key] ??
      findSimilarPerson(pick.person, store.people);
    return hit ? { key: hit.key, note: pick.note } : { key: pick.person.key, note: pick.note, inline: pick.person };
  });
  const companies = picks.companies.map((pick) => {
    const hit = resolveCompanyRef(pick.ref, store.companies) ?? store.companies[pick.company.key];
    return hit ? { key: hit.key, note: pick.note } : { key: pick.company.key, note: pick.note, inline: pick.company };
  });
  return {
    kind: "board",
    id,
    title: picks.title,
    summary: picks.summary,
    people: dedupe(people),
    companies: dedupe(companies),
    streaming,
    pending: streaming && !picks.title && people.length === 0 && companies.length === 0,
  };
}

export type GroupItem =
  | { kind: "reasoning"; id: string; text: string; streaming: boolean }
  | { kind: "tool"; part: ToolPart };

export type Segment =
  | { kind: "group"; id: string; items: GroupItem[] }
  | { kind: "text"; id: string; text: string; live: boolean }
  | { kind: "board"; id: string; part: ToolPart }
  | { kind: "notice"; id: string; text: string };

/**
 * Lays a message out the way the Composio playground does: consecutive
 * reasoning and tool calls form one collapsible group; text, boards and
 * notices sit between groups in the order they happened.
 */
export function segment(message: AgentUIMessage, streaming: boolean): Segment[] {
  const out: Segment[] = [];
  let group: Extract<Segment, { kind: "group" }> | null = null;

  message.parts.forEach((part, i) => {
    if (part.type === "reasoning") {
      if (!part.text.trim()) return;
      if (!group) {
        group = { kind: "group", id: `${message.id}-g${i}`, items: [] };
        out.push(group);
      }
      const last = group.items.at(-1);
      const isStreaming = part.state === "streaming";
      if (last?.kind === "reasoning") {
        last.text += part.text;
        last.streaming = isStreaming;
      } else {
        group.items.push({ kind: "reasoning", id: `${message.id}-r${i}`, text: part.text, streaming: isStreaming });
      }
      return;
    }
    if (isToolUIPart(part)) {
      const tp = part as ToolPart;
      if (isPresent(tp)) {
        // An empty board would only leave a gap.
        const picks = presentPicks(tp.input);
        if (tp.state !== "input-streaming" && !picks.people.length && !picks.companies.length) return;
        group = null;
        out.push({ kind: "board", id: tp.toolCallId, part: tp });
        return;
      }
      if (!group) {
        group = { kind: "group", id: `${message.id}-g${i}`, items: [] };
        out.push(group);
      }
      group.items.push({ kind: "tool", part: tp });
      return;
    }
    if (part.type === "text") {
      if (!part.text.trim()) return;
      group = null;
      const last = out.at(-1);
      if (last?.kind === "text") last.text += part.text;
      else out.push({ kind: "text", id: `${message.id}-t${i}`, text: part.text, live: false });
      return;
    }
    if (part.type === "data-notice") {
      group = null;
      out.push({ kind: "notice", id: `${message.id}-n${i}`, text: part.data.text });
    }
  });

  const lastPart = message.parts.at(-1);
  const lastSeg = out.at(-1);
  if (streaming && lastSeg?.kind === "text" && lastPart?.type === "text") lastSeg.live = true;
  return out;
}
