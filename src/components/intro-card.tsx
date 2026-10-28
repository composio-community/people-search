"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { ArrowUpRight, Check, Copy, MailPlus, Sparkles } from "lucide-react";
import { findSimilarPerson, resolvePersonRef } from "@/lib/entities";
import type { IntroDraft } from "@/lib/types";
import type { BoardActions } from "./board";
import { Avatar, Button, cx, Favicon, MaskedName } from "./ui";

function domainOf(url?: string) {
  if (!url) return undefined;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** Highlights [placeholders] the user still has to fill in. */
function Body({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[[^\]\n]{1,40}\])/g).map((part, i) =>
        /^\[[^\]]+\]$/.test(part) ? (
          <span
            key={i}
            className="rounded-[3px] bg-hover px-0.5 text-fg shadow-[inset_0_-1px_0_var(--fg-4)]"
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function IntroCard({
  draft,
  streaming,
  ...ctx
}: { draft: IntroDraft; streaming: boolean } & BoardActions) {
  const [copied, setCopied] = useState(false);

  if (!draft.subject && !draft.body) {
    return (
      <div className="overflow-hidden rounded-[12px] bg-card shadow-elevated">
        <div className="flex items-center gap-2 px-4 pt-4 pb-3 text-[15.5px]">
          <MailPlus className="h-4 w-4 text-fg-3" />
          <span className="shimmer-text">Drafting the intro…</span>
        </div>
        <div className="space-y-2 border-t border-line px-4 py-4">
          <div className="skeleton h-3 w-2/3 rounded" />
          <div className="skeleton h-3 w-full rounded" />
          <div className="skeleton h-3 w-11/12 rounded" />
          <div className="skeleton h-3 w-1/2 rounded" />
        </div>
      </div>
    );
  }

  const target =
    resolvePersonRef(draft.targetRef, ctx.people) ??
    (draft.targetName
      ? findSimilarPerson(
          {
            key: "",
            sources: [],
            firstName: draft.targetName.split(" ")[0],
            lastName: draft.targetName.split(" ").slice(1).join(" ") || undefined,
          },
          ctx.people,
        )
      : undefined);
  const words = draft.body.split(/\s+/).filter(Boolean).length;
  const toIsEmail = Boolean(draft.to?.includes("@"));
  const gmail = `https://mail.google.com/mail/?${new URLSearchParams({
    view: "cm",
    fs: "1",
    ...(toIsEmail ? { to: draft.to! } : {}),
    su: draft.subject,
    body: draft.body,
  }).toString()}`;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="overflow-hidden rounded-[12px] bg-card shadow-elevated"
    >
      <header className="flex items-center justify-between gap-4 px-4 pt-4 pb-3">
        <h3 className="flex items-center gap-2 text-[15.5px] leading-6">
          <MailPlus className="h-4 w-4 text-fg-3" />
          Intro draft
        </h3>
        <span className="mono-label text-fg-3">
          {streaming ? (
            <span className="shimmer-text">Writing · {words} words</span>
          ) : (
            <>
              {draft.style === "forwardable" ? "Forwardable" : "Direct"} · {words} words
            </>
          )}
        </span>
      </header>

      <dl className="border-t border-line text-[13.5px]">
        <div className="grid grid-cols-[72px_1fr] items-center gap-3 border-b border-line px-4 py-2.5">
          <dt className="text-fg-3">To</dt>
          <dd className="min-w-0 truncate">
            {draft.to ? <Body text={draft.to} /> : <Body text="[mutual connection]" />}
          </dd>
        </div>
        {(target || draft.targetName) && (
          <div className="grid grid-cols-[72px_1fr] items-center gap-3 border-b border-line px-4 py-2">
            <dt className="text-fg-3">About</dt>
            <dd className="min-w-0">
              {target ? (
                <button
                  type="button"
                  onClick={() => ctx.onOpen(target.key)}
                  className="group flex min-w-0 items-center gap-2.5 text-left"
                >
                  <Avatar person={target} size={24} />
                  <span className="truncate group-hover:underline group-hover:decoration-fg-4 group-hover:underline-offset-4">
                    <MaskedName person={target} />
                  </span>
                  <span className="truncate text-fg-3">
                    {[target.title, target.company].filter(Boolean).join(" · ")}
                  </span>
                </button>
              ) : (
                draft.targetName
              )}
            </dd>
          </div>
        )}
        <div className="grid grid-cols-[72px_1fr] items-center gap-3 px-4 py-2.5">
          <dt className="text-fg-3">Subject</dt>
          <dd className="min-w-0 font-medium">
            <Body text={draft.subject} />
          </dd>
        </div>
      </dl>

      <div className="border-t border-line bg-bg/50 px-4 py-4 sm:px-5">
        <p
          className={cx(
            "max-w-[640px] text-[15px] leading-7 whitespace-pre-wrap text-fg",
            streaming && "caret",
          )}
        >
          <Body text={draft.body} />
        </p>
      </div>

      {draft.hooks.length > 0 && (
        <div className="border-t border-line px-4 py-3.5">
          <p className="mono-label mb-2 flex items-center gap-1.5 text-fg-3">
            <Sparkles className="h-3 w-3" /> Built on
          </p>
          <ul className="space-y-1.5">
            {draft.hooks.map((h, i) => {
              const domain = domainOf(h.url);
              return (
                <li key={i} className="flex items-start gap-2.5 text-[13.5px] leading-5">
                  <span className="mt-0.5">
                    <Favicon domain={domain} name={h.source ?? "•"} size={16} />
                  </span>
                  <span className="min-w-0 flex-1 text-fg-2">
                    {h.text}
                    {(h.source || h.url) && (
                      <>
                        {" "}
                        {h.url ? (
                          <a
                            href={h.url.startsWith("http") ? h.url : `https://${h.url}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-0.5 font-mono text-[11.5px] text-fg-3 hover:text-brand-ink"
                          >
                            {h.source ?? domain}
                            <ArrowUpRight className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="font-mono text-[11.5px] text-fg-3">{h.source}</span>
                        )}
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!streaming && (
      <footer className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            void navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <a
          href={gmail}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-7 items-center gap-1.5 bg-card px-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-fg shadow-[inset_0_0_0_1px_var(--hairline)] transition-colors hover:bg-hover"
        >
          Open in Gmail <ArrowUpRight className="h-3 w-3" />
        </a>
        <Button size="sm" variant="ghost" onClick={() => ctx.onAsk("Make that intro shorter and more casual.")}>
          Make it shorter
        </Button>
        {draft.style === "forwardable" && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => ctx.onAsk("Rewrite it as a direct note to them instead of a forwardable intro.")}
          >
            Write as direct note
          </Button>
        )}
      </footer>
      )}
    </motion.section>
  );
}
