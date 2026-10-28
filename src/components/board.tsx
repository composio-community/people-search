"use client";

import { useState } from "react";
import { motion } from "motion/react";
import {
  ArrowUpRight,
  Building2,
  Check,
  Copy,
  Download,
  Mail,
  Phone,
  Star,
  Users,
} from "lucide-react";
import { formatPrice, formatRange, formatUsd, toolkitName } from "@/lib/catalog";
import { canRevealPerson, describeEstimate, revealEstimate } from "@/lib/reveal-plan";
import { displayName } from "@/lib/entities";
import type { Company, Person, Price, RevealAttempt, RevealMode } from "@/lib/types";
import type { BoardItem } from "./chat-state";
import { LinkedinIcon } from "./brand-icons";
import { Avatar, Button, cx, EmailStatusBadge, Favicon, MaskedName, ProviderLogo } from "./ui";

export type BoardActions = {
  people: Record<string, Person>;
  companies: Record<string, Company>;
  prices: Record<string, Price>;
  revealing: Record<string, RevealMode>;
  revealErrors: Record<string, string>;
  revealTrail: Record<string, RevealAttempt[]>;
  saved: string[];
  onReveal: (keys: string[], mode: RevealMode) => void;
  onOpen: (key: string) => void;
  onToggleSave: (key: string) => void;
  onSaveMany: (keys: string[]) => void;
  /** Puts a question in the composer for the user to edit and send. */
  onAsk: (text: string) => void;
  /** Sends a question straight away. */
  onSearch: (text: string) => void;
};

/** What revealing this person can cost, across every provider it may try. */
export function revealPrice(p: Person, prices: Record<string, Price>) {
  return revealEstimate(p, prices);
}

/** Best and worst case for revealing several people. */
export function revealTotal(people: Person[], prices: Record<string, Price>) {
  const total = people.reduce(
    (t, p) => {
      const e = revealEstimate(p, prices);
      return e ? { min: t.min + e.min, max: t.max + e.max } : t;
    },
    { min: 0, max: 0 },
  );
  return formatRange(total.min, total.max);
}

export function canReveal(p: Person) {
  return canRevealPerson(p);
}

/** Providers tried for a reveal: a spinner on the running one, ✓/✗ on the rest. */
function Trail({ attempts, compact }: { attempts?: RevealAttempt[]; compact?: boolean }) {
  if (!attempts?.length) return null;
  const paid = attempts.reduce((s, a) => s + (a.charge ?? 0), 0);
  const running = attempts.find((a) => a.state === "running");
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-fg-3" title={attempts.map((a) => `${toolkitName(a.toolkit)}: ${a.state}${a.charge ? ` ${formatUsd(a.charge)}` : ""}`).join(" → ")}>
      {attempts.map((a, i) => (
        <span key={a.slug} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-fg-4">›</span>}
          <span className={cx(a.state === "miss" || a.state === "error" ? "opacity-45" : "")}>
            <ProviderLogo toolkit={a.toolkit} size={14} />
          </span>
          {a.state === "running" ? (
            <span className="h-2.5 w-2.5 animate-spin rounded-full border border-fg-4 border-t-fg" />
          ) : a.state === "found" ? (
            <Check className="h-3 w-3 text-success" strokeWidth={3} />
          ) : a.state === "partial" ? (
            <span className="h-1.5 w-1.5 rounded-full bg-fg-3" title="Found details, not the email" />
          ) : (
            <span className={a.state === "error" ? "text-danger" : ""}>✕</span>
          )}
        </span>
      ))}
      {running && !compact && <span className="ml-1 shimmer-text">{toolkitName(running.toolkit)}…</span>}
      {!running && paid > 0 && <span className="ml-1">{formatUsd(paid)}</span>}
    </span>
  );
}

export function needsReveal(p: Person) {
  return !p.email && !p.phone && canReveal(p);
}

export function Board({ board, ...ctx }: { board: BoardItem } & BoardActions) {
  const empty = !board.people.length && !board.companies.length;
  if (board.pending || (board.streaming && empty)) return <BoardSkeleton title={board.title} />;
  if (empty) return null;
  return (
    <div className="space-y-3">
      {board.people.length > 0 && <PeopleBoard board={board} {...ctx} />}
      {board.companies.length > 0 && <CompanyGrid board={board} {...ctx} />}
    </div>
  );
}

const PAGE = 8;

function PeopleBoard({ board, ...ctx }: { board: BoardItem } & BoardActions) {
  const [selected, setSelected] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);

  const rows = board.people
    .map((r) => ({ key: r.key, note: r.note, person: ctx.people[r.key] ?? r.inline }))
    .filter((r): r is { key: string; note: string | undefined; person: Person } => Boolean(r.person));
  const visible = showAll ? rows : rows.slice(0, PAGE);
  const revealedCount = rows.filter((r) => r.person.email || r.person.phone).length;
  const selectable = rows.filter((r) => needsReveal(r.person)).map((r) => r.key);
  const toReveal = selected.filter((k) => ctx.people[k] && needsReveal(ctx.people[k]));
  const estimate = revealTotal(
    toReveal.map((k) => ctx.people[k]),
    ctx.prices,
  );
  const allSelected = selected.length > 0 && selected.length === rows.length;
  const emails = rows.map((r) => r.person.email).filter(Boolean) as string[];

  const toggle = (key: string) =>
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));

  return (
    <section className="overflow-hidden rounded-[12px] bg-card shadow-elevated">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 pt-4 pb-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[15.5px] leading-6 tracking-[-0.005em]">
            <Users className="h-4 w-4 text-fg-3" />
            {board.title}
          </h3>
          {board.summary && <p className="mt-0.5 text-[13px] leading-5 text-fg-3">{board.summary}</p>}
        </div>
        <span className="mono-label pt-1 text-fg-3">
          {board.streaming ? (
            <span className="shimmer-text">Adding people · {rows.length}</span>
          ) : (
            <>
              {rows.length} {rows.length === 1 ? "person" : "people"}
              {revealedCount > 0 && ` · ${revealedCount} revealed`}
            </>
          )}
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-y border-line bg-bg/40 px-4 py-2">
        <Checkbox
          checked={allSelected}
          indeterminate={selected.length > 0 && !allSelected}
          onChange={() => setSelected(allSelected ? [] : rows.map((r) => r.key))}
          label="Select all"
        />
        <span className="mono-label mr-auto text-fg-3">
          {selected.length ? `${selected.length} selected` : "Select"}
        </span>
        {selected.length > 0 && (
          <>
            <Button
              size="sm"
              variant="primary"
              disabled={toReveal.length === 0}
              onClick={() => {
                ctx.onReveal(toReveal, "email");
                setSelected([]);
              }}
            >
              Reveal {toReveal.length || ""}
              {toReveal.length > 0 && <span className="opacity-70">· {estimate}</span>}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                ctx.onSaveMany(selected);
                setSelected([]);
              }}
            >
              <Star className="h-3 w-3" /> Save
            </Button>
          </>
        )}
        {selected.length === 0 && selectable.length > 1 && (
          <Button size="sm" variant="ghost" onClick={() => setSelected(selectable)}>
            Select unrevealed
          </Button>
        )}
        {emails.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(emails.join("\n"));
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            }}
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Emails"}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => downloadCsv(board.title, rows.map((r) => ({ person: r.person, note: r.note })))}
        >
          <Download className="h-3 w-3" /> CSV
        </Button>
      </div>

      <div role="list">
        {visible.map((r, i) => (
          <motion.div
            key={r.key}
            role="listitem"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: Math.min(i, 10) * 0.035, ease: [0.16, 1, 0.3, 1] }}
          >
            <PersonRow
              person={r.person}
              note={r.note}
              selected={selected.includes(r.key)}
              onSelect={() => toggle(r.key)}
              {...ctx}
            />
          </motion.div>
        ))}
      </div>

      {rows.length > PAGE && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="mono-label w-full border-t border-line py-2.5 text-fg-3 transition-colors hover:bg-hover hover:text-fg"
        >
          {showAll ? "Show fewer" : `Show ${rows.length - PAGE} more`}
        </button>
      )}
    </section>
  );
}

function PersonRow({
  person,
  note,
  selected,
  onSelect,
  ...ctx
}: { person: Person; note?: string; selected: boolean; onSelect: () => void } & BoardActions) {
  const saved = ctx.saved.includes(person.key);
  return (
    <div
      onClick={() => ctx.onOpen(person.key)}
      className={cx(
        "group relative grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 border-b border-line px-4 py-3 transition-colors last:border-b-0 md:grid-cols-[auto_minmax(0,1.35fr)_minmax(0,1fr)_252px]",
        selected ? "bg-brand-wash" : "hover:bg-hover/70",
      )}
    >
      {selected && <span className="absolute inset-y-0 left-0 w-[2px] bg-brand-ink" />}
      <div onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selected} onChange={onSelect} label={`Select ${displayName(person)}`} />
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <Avatar person={person} size={36} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[14.5px] leading-5">
            <span className="truncate">
              <MaskedName person={person} />
            </span>
            {saved && <Star className="h-3 w-3 shrink-0 fill-current text-fg-2" />}
            {person.linkedinUrl && (
              <a
                href={person.linkedinUrl.startsWith("http") ? person.linkedinUrl : `https://${person.linkedinUrl}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-fg-4 transition-colors hover:text-fg"
                aria-label="LinkedIn profile"
              >
                <LinkedinIcon className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
          {(person.title || person.company) && (
            <div className="truncate text-[13px] leading-5 text-fg-2">
              {person.title}
              <span className="md:hidden">
                {person.company ? `${person.title ? " · " : ""}${person.company}` : ""}
              </span>
            </div>
          )}
          {note && <div className="truncate text-[12.5px] leading-5 text-fg-3">{note}</div>}
        </div>
      </div>

      <div className="hidden min-w-0 md:block">
        {person.company && (
          <div className="flex items-center gap-2 text-[13.5px] leading-5">
            <Favicon domain={person.companyDomain} name={person.company} />
            <span className="truncate">{person.company}</span>
          </div>
        )}
        <div className="truncate pl-6 text-[12.5px] leading-5 text-fg-3">
          {person.location ?? person.companyDomain ?? ""}
        </div>
      </div>

      <div
        className="col-start-2 mt-2 flex min-w-0 justify-start pl-12 md:col-start-auto md:mt-0 md:justify-end md:pl-0"
        onClick={(e) => e.stopPropagation()}
      >
        <ContactCell person={person} {...ctx} />
      </div>
    </div>
  );
}

export function ContactCell({ person, ...ctx }: { person: Person } & BoardActions) {
  const [copied, setCopied] = useState(false);
  const busy = ctx.revealing[person.key];
  const error = ctx.revealErrors[person.key];

  const trail = ctx.revealTrail[person.key];
  if (busy) {
    return (
      <span className="inline-flex h-7 items-center gap-2">
        {trail?.length ? (
          <Trail attempts={trail} />
        ) : (
          <span className="mono-label inline-flex items-center gap-2 text-fg-2">
            <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-fg-4 border-t-fg" />
            {busy === "verify" ? "Verifying" : "Revealing"}
          </span>
        )}
      </span>
    );
  }

  if (person.email) {
    return (
      <div className="flex max-w-[260px] flex-col items-start gap-0.5 md:items-end">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(person.email!);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="unblur group/email inline-flex max-w-full items-center gap-1.5 font-mono text-[12px] text-fg hover:text-brand-ink"
          title="Copy email"
        >
          <span className="truncate">{person.email}</span>
          {copied ? (
            <Check className="h-3 w-3 shrink-0 text-success" />
          ) : (
            <Copy className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/email:opacity-60" />
          )}
        </button>
        <div className="flex items-center gap-2">
          <Trail attempts={trail} compact />
          <EmailStatusBadge status={person.emailStatus} />
          {person.emailStatus !== "verified" && person.emailStatus !== "invalid" && (
            <button
              type="button"
              onClick={() => ctx.onReveal([person.key], "verify")}
              className="mono-label !text-[10px] text-fg-3 underline decoration-fg-4 underline-offset-2 hover:text-fg"
              title={ctx.prices.ZEROBOUNCE_VALIDATE_EMAIL?.text}
            >
              Verify {formatPrice(ctx.prices.ZEROBOUNCE_VALIDATE_EMAIL)}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (person.phone) {
    return (
      <span className="unblur inline-flex items-center gap-1.5 font-mono text-[12px]">
        <Phone className="h-3 w-3 text-fg-3" /> {person.phone}
      </span>
    );
  }

  if (!canReveal(person)) {
    return (
      <span
        className="mono-label text-fg-4"
        title="Only a name is known, so there's nothing to look an email up with. Ask the agent to find their company or LinkedIn."
      >
        Name only
      </span>
    );
  }

  const price = revealPrice(person, ctx.prices);
  return (
    <div className="flex items-center gap-2.5">
      <span className="hidden items-center gap-1.5 text-fg-4 sm:flex">
        {person.hasEmail && (
          <span title="Work email on file">
            <Mail className="h-3.5 w-3.5" />
          </span>
        )}
        {person.hasPhone && (
          <span title="Direct phone on file">
            <Phone className="h-3.5 w-3.5" />
          </span>
        )}
      </span>
      <div className="flex flex-col items-start md:items-end">
        <Button
          size="sm"
          onClick={() => ctx.onReveal([person.key], "email")}
          title={price ? describeEstimate(price) : undefined}
          className="hover:shadow-[inset_0_0_0_1px_var(--brand-ink)] hover:text-brand-ink"
        >
          Reveal
          {price && <span className="text-fg-3">· {formatRange(price.min, price.max)}</span>}
        </Button>
        {error && (
          <span className="mt-0.5 flex items-center gap-2 font-mono text-[10.5px] text-danger">
            <Trail attempts={trail} compact />
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

function CompanyGrid({ board, ...ctx }: { board: BoardItem } & BoardActions) {
  const rows = board.companies
    .map((r) => ({ key: r.key, note: r.note, company: ctx.companies[r.key] ?? r.inline }))
    .filter((r): r is { key: string; note: string | undefined; company: Company } => Boolean(r.company));
  return (
    <section className="overflow-hidden rounded-[12px] bg-card shadow-elevated">
      <header className="flex items-center justify-between gap-4 px-4 pt-4 pb-3">
        <h3 className="flex items-center gap-2 text-[15.5px] leading-6">
          <Building2 className="h-4 w-4 text-fg-3" />
          {board.people.length ? "Companies" : board.title}
        </h3>
        <span className="mono-label text-fg-3">{rows.length} companies</span>
      </header>
      <div className="grid gap-px border-t border-line bg-line sm:grid-cols-2">
        {rows.map((r, i) => (
          <motion.div
            key={r.key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: Math.min(i, 10) * 0.035, ease: [0.16, 1, 0.3, 1] }}
            className="group flex flex-col gap-2 bg-card p-4"
          >
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[8px] bg-white shadow-[inset_0_0_0_1px_rgb(15_15_15/0.08)]">
                {r.company.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.company.logoUrl} alt="" className="h-full w-full object-contain" />
                ) : (
                  <Favicon domain={r.company.domain} size={20} />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px] leading-5">{r.company.name}</div>
                {r.company.domain && (
                  <a
                    href={`https://${r.company.domain}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 font-mono text-[11.5px] text-fg-3 hover:text-brand-ink"
                  >
                    {r.company.domain}
                    <ArrowUpRight className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-fg-3">
              {r.company.industry && <span>{r.company.industry}</span>}
              {r.company.employees !== undefined && <span>{r.company.employees.toLocaleString()} people</span>}
              {r.company.location && <span>{r.company.location}</span>}
              {r.company.funding && <span>{r.company.funding}</span>}
            </div>
            {(r.note ?? r.company.description) && (
              <p className="line-clamp-2 text-[13px] leading-5 text-fg-2">{r.note ?? r.company.description}</p>
            )}
            <button
              type="button"
              onClick={() =>
                ctx.onAsk(
                  `Find the decision makers at ${r.company.name}${r.company.domain ? ` (${r.company.domain})` : ""}.`,
                )
              }
              className="mono-label mt-auto inline-flex items-center gap-1 self-start pt-1 text-fg-3 transition-colors hover:text-brand-ink"
            >
              Find people <ArrowUpRight className="h-3 w-3" />
            </button>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

export function Checkbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      onClick={onChange}
      className={cx(
        "grid h-4 w-4 shrink-0 place-items-center rounded-[4px] transition-colors",
        checked || indeterminate
          ? "bg-brand text-on-brand"
          : "bg-card shadow-[inset_0_0_0_1px_var(--hairline)] hover:shadow-[inset_0_0_0_1px_var(--fg-3)]",
      )}
    >
      {indeterminate ? (
        <span className="h-[1.5px] w-2 bg-current" />
      ) : checked ? (
        <Check className="h-3 w-3" strokeWidth={3} />
      ) : null}
    </button>
  );
}

function BoardSkeleton({ title }: { title?: string }) {
  return (
    <div className="overflow-hidden rounded-[12px] bg-card shadow-elevated">
      <div className="flex items-center justify-between gap-4 px-4 pt-4 pb-3">
        {title ? (
          <h3 className="flex items-center gap-2 text-[15.5px] leading-6">
            <Users className="h-4 w-4 text-fg-3" />
            {title}
          </h3>
        ) : (
          <div className="skeleton h-4 w-48 rounded" />
        )}
        <span className="mono-label shimmer-text">Adding people</span>
      </div>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-t border-line px-4 py-3.5">
          <div className="skeleton h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <div className="skeleton h-3 w-40 rounded" />
            <div className="skeleton h-3 w-56 rounded" />
          </div>
          <div className="skeleton h-7 w-24 rounded" />
        </div>
      ))}
    </div>
  );
}

export function downloadCsv(title: string, rows: Array<{ person: Person; note?: string }>) {
  const header = ["Name", "Title", "Company", "Domain", "Location", "Email", "Email status", "Phone", "LinkedIn", "Sources", "Note"];
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    header.join(","),
    ...rows.map(({ person: p, note }) =>
      [
        displayName(p),
        p.title,
        p.company,
        p.companyDomain,
        p.location,
        p.email,
        p.emailStatus,
        p.phone,
        p.linkedinUrl,
        p.sources.join(" "),
        note,
      ]
        .map(esc)
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "people"}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
