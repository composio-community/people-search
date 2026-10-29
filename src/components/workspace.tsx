"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowRight, ArrowUpRight, CircleAlert, LogOut, Plus, Star, Wallet } from "lucide-react";
import { formatUsd } from "@/lib/catalog";
import { displayName } from "@/lib/entities";
import type { RevealEvent, RevealMode } from "@/lib/types";
import type { AgentUIMessage } from "@/lib/ui-message";
import { Board, type BoardActions } from "./board";
import {
  boardFromBlock,
  boardFromPart,
  createUIStore,
  deriveStore,
  initialUI,
  segment,
  type PersistedUI,
  type Store,
  type UIState,
} from "./chat-state";
import { Composer } from "./composer";
import { IntroCard } from "./intro-card";
import { JobsBoard, whoIsHiring } from "./jobs-board";
import { ListPanel } from "./list-panel";
import { Mosaic } from "./mosaic";
import { ComposioLogo, ComposioMark } from "./logos";
import { PersonDrawer } from "./person-drawer";
import { SignInDialog } from "./sign-in-dialog";
import { TextSegment } from "./text-segment";
import { ThemeToggle } from "./theme-toggle";
import { DotMatrix, TimelineGroup } from "./timeline";
import { cx, InstantChip, Odometer } from "./ui";

type User = { name?: string; email?: string; picture?: string };

const SUGGESTIONS = [
  {
    label: "Staff ML engineers in SF who've shipped LLM inference",
    text: "Find staff ML engineers in San Francisco who've shipped LLM inference in production.",
  },
  {
    label: "Senior iOS engineers at fintechs in London",
    text: "Find senior iOS engineers working at fintech companies in London.",
  },
  {
    label: "Heads of Growth at Series B devtools startups",
    text: "Find Heads of Growth at Series B devtools startups.",
  },
  {
    label: "Founding designers who've worked at Linear or Vercel",
    text: "Find founding designers who've worked at Linear or Vercel.",
  },
  {
    label: "Companies hiring Rust engineers, and their hiring managers",
    text: "Find companies hiring Rust engineers right now, and their likely hiring managers.",
  },
];

export type Restored = { chatId: string; messages: AgentUIMessage[]; ui: Partial<PersistedUI> | null };

/**
 * Saves the workspace to the server. One request at a time; changes made
 * meanwhile go out together as soon as it lands. `keepalive` lets the last
 * save finish even if the page is reloading.
 */
function workspaceSaver() {
  let inFlight = false;
  let queued: PersistedUI | null = null;
  const send = (state: PersistedUI) => {
    inFlight = true;
    const body = JSON.stringify(state);
    fetch("/api/workspace", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body,
      keepalive: body.length < 60_000,
    })
      .catch(() => {})
      .finally(() => {
        inFlight = false;
        const next = queued;
        queued = null;
        if (next) send(next);
      });
  };
  return (state: PersistedUI) => {
    if (inFlight) queued = state;
    else send(state);
  };
}

export function Workspace({
  user,
  model,
  authError,
  initialPrompt,
  restored,
}: {
  /** Null for a visitor: they can look around, and sending asks them to sign in. */
  user: User | null;
  model: string;
  authError?: string;
  /** A message carried through sign-in (`?q=`): sent once signed in, else left in the composer. */
  initialPrompt?: string;
  /** Where the last visit left off: the open chat and the saved workspace. */
  restored: Restored;
}) {
  const [uiStore] = useState(() =>
    createUIStore(initialUI(restored.chatId, restored.ui), user ? workspaceSaver() : () => {}),
  );
  const ui = useSyncExternalStore(uiStore.subscribe, uiStore.get, uiStore.get);
  const dispatch = uiStore.dispatch;
  const [draft, setDraft] = useState(user ? "" : (initialPrompt ?? ""));
  // A visitor's search waits here while the sign-in dialog is open.
  const signInRef = useRef<HTMLDialogElement>(null);
  const [signInPrompt, setSignInPrompt] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resumed = useRef(false);

  // The AI SDK chat protocol, as in the Composio playground: the server keeps
  // the history and streams UI message chunks; only the newest message goes up.
  const transport = useMemo(
    () =>
      new DefaultChatTransport<AgentUIMessage>({
        api: "/api/chat",
        fetch: async (url, init) => {
          const res = await fetch(url, init);
          if (res.status === 401) dispatch({ type: "auth-expired" });
          return res;
        },
        prepareSendMessagesRequest: ({ id, messages, body }) => ({
          body: { ...body, id, message: messages[messages.length - 1] },
        }),
      }),
    [dispatch],
  );

  const { messages, sendMessage, regenerate, status, stop, error } = useChat<AgentUIMessage>({
    id: ui.chatId,
    // Only the chat the page was loaded with has stored messages; a new one starts empty.
    messages: ui.chatId === restored.chatId ? restored.messages : undefined,
    transport,
    experimental_throttle: 50,
    onData: (part) => {
      if (part.type === "data-status") dispatch({ type: "phase", text: part.data.text });
    },
    onFinish: () => dispatch({ type: "phase", text: null }),
    onError: (err) => {
      dispatch({ type: "phase", text: null });
      if (/session expired/i.test(err.message)) dispatch({ type: "auth-expired" });
    },
  });

  const busy = status === "submitted" || status === "streaming";
  const store = useMemo(() => deriveStore(messages, ui.patches), [messages, ui.patches]);
  const spent = ui.carriedSpent + store.toolSpent + ui.revealSpent;
  const lastCharge = ui.lastReveal
    ? { key: `r${ui.lastReveal.at}`, amount: ui.lastReveal.amount }
    : store.lastToolCharge
      ? { key: store.lastToolCharge.id, amount: store.lastToolCharge.amount }
      : undefined;

  function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    if (!user) {
      openSignIn(text);
      return;
    }
    setDraft("");
    dispatch({ type: "phase", text: "Starting…" });
    void sendMessage({ text }, { body: turnBody() });
  }

  function openSignIn(prompt: string | null) {
    setSignInPrompt(prompt);
    signInRef.current?.showModal();
    signInRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }

  /** What the server needs besides the message: the cap, the spend so far and who's been revealed. */
  function turnBody() {
    const revealed = Object.values(store.people)
      .filter((p) => p.revealed && p.email)
      .slice(-40)
      .map((p) => ({
        name: displayName(p),
        title: p.title,
        company: p.company,
        email: p.email,
        status: p.emailStatus,
      }));
    return { budget: ui.budget, spentBefore: spent, revealed };
  }

  async function reveal(keys: string[], mode: RevealMode) {
    const targets = keys
      .map((k) => store.people[k])
      .filter((p) => p && !ui.revealing[p.key] && (mode === "verify" ? p.email : true));
    for (let i = 0; i < targets.length; i += 10) {
      const chunk = targets.slice(i, i + 10);
      const chunkKeys = chunk.map((p) => p.key);
      dispatch({ type: "reveal-start", keys: chunkKeys, mode });
      try {
        const res = await fetch("/api/reveal", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode,
            people: chunk.map((p) => ({
              key: p.key,
              apolloId: p.apolloId,
              firstName: p.firstName,
              lastName: p.lastName,
              name: p.name,
              company: p.company,
              companyDomain: p.companyDomain,
              linkedinUrl: p.linkedinUrl,
              email: p.email,
            })),
          }),
        });
        if (res.status === 401) {
          dispatch({ type: "auth-expired" });
          dispatch({
            type: "reveal-fail",
            keys: chunkKeys,
            error: "Session expired",
          });
          return;
        }
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          dispatch({
            type: "reveal-fail",
            keys: chunkKeys,
            error: body.error ?? "Reveal failed",
          });
          continue;
        }
        // Each provider attempt streams in as it happens.
        const settled = new Set<string>();
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let nl: number;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            const event = JSON.parse(line) as RevealEvent;
            if (event.type === "error") {
              if (event.code === "auth") dispatch({ type: "auth-expired" });
              dispatch({
                type: "reveal-fail",
                keys: chunkKeys.filter((k) => !settled.has(k)),
                error: event.message,
              });
              continue;
            }
            if (event.type === "person") settled.add(event.key);
            dispatch({ type: "reveal-event", event, at: Date.now() });
          }
        }
        const unsettled = chunkKeys.filter((k) => !settled.has(k));
        if (unsettled.length)
          dispatch({
            type: "reveal-fail",
            keys: unsettled,
            error: "Interrupted",
          });
      } catch {
        dispatch({
          type: "reveal-fail",
          keys: chunkKeys,
          error: "Network error",
        });
      }
    }
  }

  function ask(text: string) {
    setDraft(text);
    inputRef.current?.focus();
  }

  const actions: BoardActions = {
    people: store.people,
    companies: store.companies,
    prices: store.prices,
    revealing: ui.revealing,
    revealErrors: ui.revealErrors,
    revealTrail: ui.revealTrail,
    saved: ui.saved,
    onReveal: (keys, mode) => void reveal(keys, mode),
    onOpen: (key) => dispatch({ type: "open-person", key }),
    onToggleSave: (key) => dispatch({ type: "toggle-save", key }),
    onSaveMany: (keys) => dispatch({ type: "save-many", keys }),
    onAsk: ask,
    onSearch: (text) => send(text),
  };

  const composer = (hero: boolean) => (
    <Composer
      value={draft}
      onChange={setDraft}
      onSend={() => send(draft)}
      onStop={() => void stop()}
      busy={busy}
      variant={hero ? "hero" : "chat"}
      note={hero && !user ? "You'll sign in with Composio when you search." : undefined}
      budget={ui.budget}
      onBudget={(value) => dispatch({ type: "budget", value })}
      inputRef={inputRef}
      model={model}
      autoFocus={hero}
      placeholder={
        hero ? "Senior backend engineers in Berlin…" : "Ask a follow-up, or describe another hire…"
      }
    />
  );

  const empty = messages.length === 0;
  const lastMessage = messages.at(-1);

  // Back from sign-in with a message: send it once, on first mount.
  const resume = (el: HTMLDivElement | null) => {
    if (!el || resumed.current || !user || !initialPrompt) return;
    resumed.current = true;
    window.history.replaceState(null, "", "/");
    send(initialPrompt);
  };

  return (
    <div ref={resume} className="flex h-dvh flex-col">
      <Header
        ui={ui}
        spent={spent}
        lastCharge={lastCharge}
        hasMessages={!empty}
        user={user}
        onNew={() => {
          void stop();
          setDraft("");
          dispatch({ type: "new-chat", chatId: crypto.randomUUID(), carried: store.toolSpent });
        }}
        onList={() => dispatch({ type: "list", open: true })}
        onSignIn={() => openSignIn(null)}
      />

      {authError && !user && (
        <div className="flex items-center justify-center gap-3 border-b border-line bg-card px-4 py-2.5 text-[13.5px]">
          <CircleAlert className="h-4 w-4 shrink-0 text-warning" />
          <span className="min-w-0 truncate">Sign-in didn&apos;t finish: {authError}</span>
        </div>
      )}

      {ui.authExpired && (
        <div className="flex items-center justify-center gap-3 border-b border-line bg-card px-4 py-2.5 text-[13.5px]">
          <CircleAlert className="h-4 w-4 text-warning" />
          Your Composio session expired.
          <a href="/api/auth/login" className="mono-label text-brand-ink underline underline-offset-4">
            Sign in again
          </a>
        </div>
      )}

      {empty ? (
        <main className="relative flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 py-6 sm:py-10">
          <Mosaic />
          {/* my-auto centres the card, and lets it scroll from the top when it's taller than the screen */}
          <section className="rise relative my-auto w-full max-w-[780px] bg-card shadow-pop">
            <div className="px-5 pt-9 pb-6 sm:px-14 sm:pt-14 sm:pb-10">
              <h1 className="text-[40px] leading-[1.02] tracking-[-0.035em] sm:text-[60px]">
                <span className="sm:block">Describe the hire. </span>
                <span className="sm:block">Meet the people.</span>
              </h1>
              <p className="mt-4 max-w-[560px] text-[16px] leading-7 text-fg-2 sm:text-[17.5px]">
                People Search finds them, their verified email, and the exact price before you pay.
              </p>
              <div className="mt-8">{composer(true)}</div>
              <ol className="mt-8 border-t border-line">
                {SUGGESTIONS.map((s, i) => (
                  <li key={s.text} className="rise" style={{ animationDelay: `${140 + i * 70}ms` }}>
                    <button
                      type="button"
                      onClick={() => send(s.text)}
                      className="group flex w-full items-center gap-5 border-b border-line py-4 text-left transition-colors hover:text-fg"
                    >
                      <span className="font-mono text-[12px] text-fg-4 tabular-nums transition-colors group-hover:text-brand-ink">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1 text-[15.5px] leading-6 text-fg-2 transition-colors group-hover:text-fg sm:text-[16.5px]">
                        {s.label}
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-fg-3 transition-[transform,color] group-hover:translate-x-1 group-hover:text-fg" />
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </main>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col">
          {/* column-reverse keeps the view pinned to the newest message until you scroll up */}
          <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto">
            <div className="mx-auto w-full max-w-[940px] space-y-6 px-4 pt-8 pb-10 sm:px-6">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={m.id} className="rise flex justify-end">
                    <p className="max-w-[min(620px,85%)] bg-fg/10 px-4 py-2.5 text-[15px] leading-6 whitespace-pre-wrap text-fg shadow-[inset_0_0_0_1px_var(--line)]">
                      {m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}
                    </p>
                  </div>
                ) : (
                  <AssistantMessage
                    key={m.id}
                    message={m}
                    live={busy && i === messages.length - 1}
                    phase={ui.phase}
                    store={store}
                    actions={actions}
                  />
                ),
              )}
              {busy && lastMessage?.role === "user" && <Waiting phase={ui.phase} />}
              {!busy && !error && lastMessage?.role === "user" && (
                <div className="flex items-center gap-3 text-[14px] text-fg-2">
                  <CircleAlert className="h-4 w-4 shrink-0 text-warning" />
                  This answer was interrupted.
                  <button
                    type="button"
                    onClick={() => {
                      dispatch({ type: "phase", text: "Starting…" });
                      void regenerate({ body: turnBody() });
                    }}
                    className="mono-label text-brand-ink underline underline-offset-4"
                  >
                    Retry
                  </button>
                </div>
              )}
              {error && !busy && (
                <div className="flex items-start gap-2.5 rounded-[12px] bg-card px-4 py-3 text-[14px] shadow-elevated">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                  <div>
                    <p>{error.message || "Something went wrong."}</p>
                    {/session expired/i.test(error.message) && (
                      <a
                        href="/api/auth/login"
                        className="mono-label mt-1 inline-block text-brand-ink underline underline-offset-4"
                      >
                        Sign in again
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="relative border-t border-line bg-bg/85 backdrop-blur-xl">
            <div className="mx-auto w-full max-w-[940px] px-4 py-3 sm:px-6">{composer(false)}</div>
          </div>
        </main>
      )}

      <SignInDialog ref={signInRef} prompt={signInPrompt} />
      <PersonDrawer
        person={ui.openPerson ? (store.people[ui.openPerson] ?? null) : null}
        onClose={() => dispatch({ type: "open-person", key: null })}
        {...actions}
      />
      <ListPanel
        open={ui.listOpen}
        onClose={() => dispatch({ type: "list", open: false })}
        onClear={() => dispatch({ type: "unsave-all" })}
        {...actions}
      />
    </div>
  );
}

const DONE = new Set(["output-available", "output-error", "output-denied"]);

/** Shown whenever the turn is live but nothing is streaming yet, so there's never a silent gap. */
function Waiting({ phase }: { phase: string | null }) {
  return (
    <div className="rise flex min-h-10 items-center gap-2.5 text-[15px] text-fg-2">
      <DotMatrix state="thinking" label={phase ?? "Thinking"} />
      <span className="shimmer-text">
        {phase && !/^(Starting|Connecting|Loading)/.test(phase) ? phase : "Thinking…"}
      </span>
    </div>
  );
}

function AssistantMessage({
  message,
  live,
  phase,
  store,
  actions,
}: {
  message: AgentUIMessage;
  live: boolean;
  phase: string | null;
  store: Store;
  actions: BoardActions;
}) {
  const segments = segment(message, live);
  const starts = message.metadata?.toolStartedAt ?? {};
  const tail = segments.at(-1);
  const tailActive =
    tail?.kind === "text"
      ? tail.live
      : tail?.kind === "group"
        ? tail.items.some((it) => (it.kind === "reasoning" ? it.streaming : !DONE.has(it.part.state)))
        : tail?.kind === "board"
          ? tail.part.state === "input-streaming"
          : false;

  return (
    <div className="space-y-1">
      {segments.map((seg, i) => {
        if (seg.kind === "group") {
          return (
            <TimelineGroup
              key={seg.id}
              items={seg.items}
              starts={starts}
              live={live}
              current={live && i === segments.length - 1}
              prices={store.prices}
            />
          );
        }
        if (seg.kind === "board") {
          return (
            <div key={seg.id} className="rise py-2">
              <Board board={boardFromPart(seg.part, store)} {...actions} />
            </div>
          );
        }
        if (seg.kind === "notice") {
          return (
            <p key={seg.id} className="flex items-start gap-2 py-2 text-[13.5px] text-fg-2">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              {seg.text}
            </p>
          );
        }
        return (
          <div key={seg.id} className="py-1">
            <TextSegment
              id={seg.id}
              text={seg.text}
              live={seg.live}
              renderBoard={(kind, raw, open, id) => (
                <Board board={boardFromBlock(kind, raw, open, id, store)} {...actions} />
              )}
              renderJobs={(board, open) => (
                <JobsBoard board={board} streaming={open} onWhoIsHiring={(job) => actions.onSearch(whoIsHiring(job))} />
              )}
              renderIntro={(draft, open) => <IntroCard draft={draft} streaming={open} {...actions} />}
            />
          </div>
        );
      })}
      {live && !tailActive && <Waiting phase={phase} />}
    </div>
  );
}

function Header({
  ui,
  spent,
  lastCharge,
  hasMessages,
  user,
  onNew,
  onList,
  onSignIn,
}: {
  ui: UIState;
  spent: number;
  lastCharge?: { key: string; amount: number };
  hasMessages: boolean;
  user: User | null;
  onNew: () => void;
  onList: () => void;
  onSignIn: () => void;
}) {
  const label = user?.name ?? user?.email ?? "Composio user";
  const initials = label
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-bg/85 px-3 backdrop-blur-xl sm:px-4">
      <Link href="/" className="flex items-center gap-2.5 text-fg">
        <ComposioLogo className="h-[20px] w-auto" />
        <span className="hidden sm:inline-flex">
          <InstantChip />
        </span>
        <span className="hidden text-fg-4 md:inline">/</span>
        <span className="hidden text-[14px] text-fg-2 md:inline">People Search</span>
      </Link>

      <div className="ml-auto flex items-center gap-1">
        {hasMessages && (
          <button
            type="button"
            onClick={onNew}
            className="hidden h-9 items-center gap-1.5 px-3 font-mono text-[11px] uppercase tracking-[0.06em] text-fg-2 transition-colors hover:bg-hover hover:text-fg sm:inline-flex"
          >
            <Plus className="h-3.5 w-3.5" /> New
          </button>
        )}

        {user && (
          <div
            className="relative flex h-9 items-center gap-2 px-3 shadow-[inset_0_0_0_1px_var(--line)]"
            title="Instant charges this session, billed to your Composio wallet"
          >
            <Wallet className="h-3.5 w-3.5 text-fg-3" />
            <span className="mono-label hidden text-fg-3 sm:inline">Spent</span>
            <span className="text-[13px] text-fg">
              <Odometer value={spent} digits={4} />
            </span>
            {lastCharge && (
              <span
                key={lastCharge.key}
                className="pointer-events-none absolute -bottom-5 right-2 font-mono text-[11px] text-fg-2"
                style={{
                  animation: "charge-float 1.8s var(--ease-out-expo) both",
                }}
              >
                +{formatUsd(lastCharge.amount)}
              </span>
            )}
          </div>
        )}

        {user && (
          <button
            type="button"
            onClick={onList}
            className="inline-flex h-9 items-center gap-1.5 px-3 font-mono text-[11px] uppercase tracking-[0.06em] text-fg-2 transition-colors hover:bg-hover hover:text-fg"
          >
            <Star className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">List</span>
            {ui.saved.length > 0 && (
              <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-cta px-1 text-[10px] text-on-cta">
                {ui.saved.length}
              </span>
            )}
          </button>
        )}

        <ThemeToggle />

        {!user && (
          <button
            type="button"
            onClick={onSignIn}
            className="ml-1 inline-flex h-9 items-center gap-2 bg-cta px-3.5 font-mono text-[11px] uppercase tracking-[0.06em] text-on-cta transition-opacity hover:opacity-85"
          >
            <ComposioMark className="h-3.5 w-3.5" /> Sign in
          </button>
        )}

        {user && (
          <>
            <button
              type="button"
              popoverTarget="user-menu"
              aria-label="Account"
              className="ml-1 grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-hover font-mono text-[11px] text-fg shadow-[inset_0_0_0_1px_var(--hairline)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--fg-3)]"
            >
              {user.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.picture} alt="" className="h-full w-full object-cover" />
              ) : (
                initials || "·"
              )}
            </button>
            <div
              id="user-menu"
              popover="auto"
              className="fixed inset-auto top-[60px] right-3 m-0 w-[280px] rounded-[12px] bg-popover p-1.5 text-fg shadow-pop"
            >
              <div className="px-3 pt-2 pb-3">
                <div className="truncate text-[14px]">{user.name ?? "Signed in"}</div>
                {user.email && <div className="truncate font-mono text-[11.5px] text-fg-3">{user.email}</div>}
                <div className="mono-label mt-2 text-fg-3">Via connect.composio.dev/mcp</div>
              </div>
              <a
                href="https://composio.dev/instant"
                target="_blank"
                rel="noreferrer"
                className={cx(
                  "flex h-9 items-center gap-2 rounded-[8px] px-3 text-[13.5px] text-fg-2 hover:bg-hover hover:text-fg",
                )}
              >
                <Wallet className="h-3.5 w-3.5" /> About Composio Instant
                <ArrowUpRight className="ml-auto h-3.5 w-3.5" />
              </a>
              <form action="/api/auth/logout" method="post">
                <button
                  type="submit"
                  className="flex h-9 w-full items-center gap-2 rounded-[8px] px-3 text-left text-[13.5px] text-fg-2 hover:bg-hover hover:text-fg"
                >
                  <LogOut className="h-3.5 w-3.5" /> Sign out
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
