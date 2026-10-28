"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, MapPin, MessageSquareText, Star, X } from "lucide-react";
import { formatRange, formatUsd, toolkitName } from "@/lib/catalog";
import { displayName } from "@/lib/entities";
import type { Person } from "@/lib/types";
import { canReveal, ContactCell, revealPrice, type BoardActions } from "./board";
import { GithubIcon, LinkedinIcon, XIcon } from "./brand-icons";
import { Avatar, Button, cx, Favicon, MaskedName, ProviderLogo } from "./ui";

function href(url: string) {
  return url.startsWith("http") ? url : `https://${url}`;
}

export function PersonDrawer({
  person,
  onClose,
  ...ctx
}: { person: Person | null; onClose: () => void } & BoardActions) {
  return (
    <AnimatePresence>
      {person && (
        <>
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-fg/10 backdrop-blur-[2px]"
          />
          <motion.aside
            key="drawer"
            role="dialog"
            aria-label={displayName(person)}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 34, stiffness: 340 }}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[460px] flex-col bg-card shadow-pop"
          >
            <Body person={person} onClose={onClose} {...ctx} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Body({ person, onClose, ...ctx }: { person: Person; onClose: () => void } & BoardActions) {
  const saved = ctx.saved.includes(person.key);
  const price = revealPrice(person, ctx.prices);
  const locked = !person.email && !person.phone;
  const first = person.firstName ?? displayName(person).split(" ")[0];

  return (
    <>
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <span className="mono-label text-fg-3">Profile</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => ctx.onToggleSave(person.key)}
            className={cx(
              "inline-flex h-8 items-center gap-1.5 px-2.5 font-mono text-[11px] uppercase tracking-[0.06em] transition-colors hover:bg-hover",
              saved ? "text-fg" : "text-fg-3",
            )}
          >
            <Star className={cx("h-3.5 w-3.5", saved && "fill-current")} />
            {saved ? "Saved" : "Save"}
          </button>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            aria-label="Close"
            className="grid h-8 w-8 place-items-center text-fg-3 transition-colors hover:bg-hover hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-6 pb-5">
          <Avatar person={person} size={64} />
          <h2 className="mt-4 text-[24px] leading-tight tracking-[-0.02em]">
            <MaskedName person={person} />
          </h2>
          {person.title && <p className="mt-1 text-[15px] leading-6 text-fg-2">{person.title}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13.5px] text-fg-2">
            {person.company && (
              <span className="inline-flex items-center gap-1.5">
                <Favicon domain={person.companyDomain} />
                {person.companyDomain ? (
                  <a
                    href={`https://${person.companyDomain}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 hover:text-brand-ink"
                  >
                    {person.company}
                    <ArrowUpRight className="h-3 w-3" />
                  </a>
                ) : (
                  person.company
                )}
              </span>
            )}
            {person.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-fg-3" />
                {person.location}
              </span>
            )}
          </div>
          {person.headline && person.headline !== person.title && (
            <p className="mt-3 text-[13.5px] leading-6 text-fg-3">{person.headline}</p>
          )}
        </div>

        <Section title="Contact">
          <div className="rounded-[10px] shadow-[inset_0_0_0_1px_var(--line)]">
            <Row label="Email">
              <ContactCell person={person} {...ctx} />
            </Row>
            {person.phone && (
              <Row label="Phone">
                <span className="font-mono text-[12.5px]">{person.phone}</span>
              </Row>
            )}
            {(person.linkedinUrl || person.twitterUrl || person.githubUrl) && (
              <Row label="Profiles">
                <span className="flex items-center gap-3 text-fg-2">
                  {person.linkedinUrl && (
                    <a href={href(person.linkedinUrl)} target="_blank" rel="noreferrer" className="hover:text-fg" aria-label="LinkedIn">
                      <LinkedinIcon className="h-4 w-4" />
                    </a>
                  )}
                  {person.twitterUrl && (
                    <a href={href(person.twitterUrl)} target="_blank" rel="noreferrer" className="hover:text-fg" aria-label="X">
                      <XIcon className="h-4 w-4" />
                    </a>
                  )}
                  {person.githubUrl && (
                    <a href={href(person.githubUrl)} target="_blank" rel="noreferrer" className="hover:text-fg" aria-label="GitHub">
                      <GithubIcon className="h-4 w-4" />
                    </a>
                  )}
                </span>
              </Row>
            )}
          </div>
          {locked && canReveal(person) && (
            <p className="mt-3 text-[13px] leading-5 text-fg-3">
              Revealing unlocks the full name, work email and its verification status
              {person.hasPhone ? ", plus a direct phone when one is on file" : ""}. It costs{" "}
              <span className="font-mono text-fg-2">{price ? formatRange(price.min, price.max) : "an unknown amount"}</span>{" "}
              from your Composio wallet.
              {price && (
                <span className="mt-2 block font-mono text-[11.5px] leading-5 text-fg-3">
                  {price.steps.map((s, i) => (
                    <span key={i} className="block">
                      {i + 1}. {s.label} {s.price}
                      {s.onlyIfFound ? ", only if found" : ""}
                    </span>
                  ))}
                  Stops at the first hit; at most {formatUsd(price.max)}.
                </span>
              )}
            </p>
          )}
        </Section>

        {person.employment && person.employment.length > 0 && (
          <Section title="Experience">
            <ol className="relative space-y-4 border-l border-line pl-4">
              {person.employment.slice(0, 8).map((job, i) => (
                <li key={i} className="relative">
                  <span
                    className={cx(
                      "absolute top-1.5 -left-[20.5px] h-2 w-2 rounded-full ring-4 ring-card",
                      job.current ? "bg-fg" : "bg-fg-4",
                    )}
                  />
                  <div className="text-[14px] leading-5">{job.title ?? "Role"}</div>
                  <div className="text-[13px] leading-5 text-fg-2">{job.company}</div>
                  <div className="font-mono text-[11px] text-fg-3">
                    {[job.start?.slice(0, 7), job.current ? "now" : job.end?.slice(0, 7)].filter(Boolean).join(" → ")}
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        )}

        <Section title="Provenance">
          <div className="flex flex-wrap items-center gap-2">
            {person.sources.length ? (
              person.sources.map((s) => (
                <span
                  key={s}
                  className="inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-[12.5px] shadow-[inset_0_0_0_1px_var(--line)]"
                >
                  <ProviderLogo toolkit={s} size={16} />
                  {toolkitName(s)}
                </span>
              ))
            ) : (
              <span className="text-[13px] text-fg-3">From the agent&apos;s answer</span>
            )}
            <span className="ml-auto font-mono text-[11.5px] text-fg-3">
              Spent {formatUsd(person.spent ?? 0)}
            </span>
          </div>
        </Section>
      </div>

      <div className="flex gap-2 border-t border-line p-4">
        {locked && canReveal(person) && (
          <Button
            variant="primary"
            className="flex-1"
            disabled={Boolean(ctx.revealing[person.key])}
            onClick={() => ctx.onReveal([person.key], "email")}
          >
            Reveal contact · {price ? formatRange(price.min, price.max) : ""}
          </Button>
        )}
        <Button
          className={locked && canReveal(person) ? "" : "flex-1"}
          onClick={() => {
            ctx.onAsk(
              `Tell me more about ${displayName(person).includes("*") ? first : displayName(person)}${
                person.title ? `, ${person.title}` : ""
              }${person.company ? ` at ${person.company}` : ""}.`,
            );
            onClose();
          }}
        >
          <MessageSquareText className="h-3.5 w-3.5" />
          Ask about {first}
        </Button>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line px-5 py-5">
      <h3 className="mono-label mb-3 text-fg-3">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 border-b border-line px-3.5 py-2.5 last:border-b-0">
      <span className="text-[13px] text-fg-3">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
