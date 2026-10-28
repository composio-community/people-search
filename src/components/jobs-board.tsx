"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { ArrowUpRight, Briefcase, MapPin, UserSearch } from "lucide-react";
import type { JobRow, JobsBlock } from "@/lib/blocks";
import { Button, cx, Favicon } from "./ui";

const PAGE = 8;

/** The question a "Who's hiring?" click sends for one posting. */
export function whoIsHiring(job: JobRow) {
  return `Who's hiring for the ${job.role} role at ${job.company}${job.domain ? ` (${job.domain})` : ""}? Find the likely hiring manager and a recruiter there.`;
}

/**
 * Job postings from a ```jobs block, filling in row by row as the agent writes
 * them. Each one links to its posting and can find the people hiring for it.
 */
export function JobsBoard({
  board,
  streaming,
  onWhoIsHiring,
}: {
  board: JobsBlock;
  streaming: boolean;
  onWhoIsHiring: (job: JobRow) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const rows = board.rows;
  const visible = showAll || streaming ? rows : rows.slice(0, PAGE);
  if (!rows.length && !streaming) return null;

  return (
    <section className="overflow-hidden rounded-[12px] bg-card shadow-elevated">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 pt-4 pb-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[15.5px] leading-6 tracking-[-0.005em]">
            <Briefcase className="h-4 w-4 text-fg-3" />
            {board.title || "Open roles"}
          </h3>
          {board.summary && <p className="mt-0.5 text-[13px] leading-5 text-fg-3">{board.summary}</p>}
        </div>
        <span className="mono-label pt-1 text-fg-3">
          {streaming ? (
            <span className="shimmer-text">Adding roles · {rows.length}</span>
          ) : (
            `${rows.length} ${rows.length === 1 ? "role" : "roles"}`
          )}
        </span>
      </header>

      <div className="border-t border-line">
        {visible.map((job, i) => (
          <motion.div
            key={`${job.company}-${job.role}-${i}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: streaming ? 0 : Math.min(i, 10) * 0.035, ease: [0.16, 1, 0.3, 1] }}
          >
            <JobRowView job={job} onWhoIsHiring={() => onWhoIsHiring(job)} disabled={streaming} />
          </motion.div>
        ))}
        {streaming && (
          <div className="flex items-center gap-3 border-t border-line px-4 py-3.5">
            <div className="skeleton h-9 w-9 rounded-[8px]" />
            <div className="flex-1 space-y-1.5">
              <div className="skeleton h-3 w-56 rounded" />
              <div className="skeleton h-3 w-36 rounded" />
            </div>
          </div>
        )}
      </div>

      {!streaming && rows.length > PAGE && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="mono-label w-full border-t border-line py-2.5 text-fg-3 transition-colors hover:bg-hover hover:text-fg"
        >
          {showAll ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}

function JobRowView({ job, onWhoIsHiring, disabled }: { job: JobRow; onWhoIsHiring: () => void; disabled: boolean }) {
  return (
    <div className="group grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 border-b border-line px-4 py-3.5 last:border-b-0 md:grid-cols-[auto_minmax(0,1fr)_auto]">
      <span className="mt-0.5 grid h-9 w-9 place-items-center rounded-[8px] bg-bg shadow-[inset_0_0_0_1px_var(--line)]">
        <Favicon domain={job.domain} name={job.company} size={20} />
      </span>

      <div className="min-w-0">
        <div className="text-[14.5px] leading-5">{job.role}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] leading-5 text-fg-2">
          <span>{job.company}</span>
          {job.location && (
            <span className="inline-flex items-center gap-1 text-fg-3">
              <MapPin className="h-3 w-3" />
              {job.location}
            </span>
          )}
        </div>
        {job.note && <div className="mt-0.5 text-[12.5px] leading-5 text-fg-3">{job.note}</div>}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[11px]">
          {job.salary && (
            <span className="rounded-[4px] bg-success/10 px-1.5 py-px text-success">{job.salary}</span>
          )}
          {job.posted && <span className="text-fg-3">{job.posted}</span>}
        </div>
      </div>

      <div className="col-start-2 flex flex-wrap items-center gap-2 md:col-start-auto md:justify-end">
        <Button
          size="sm"
          disabled={disabled}
          onClick={onWhoIsHiring}
          title="Find the likely hiring manager and a recruiter for this role"
          className="hover:text-brand-ink hover:shadow-[inset_0_0_0_1px_var(--brand-ink)]"
        >
          <UserSearch className="h-3.5 w-3.5" /> Who&apos;s hiring
        </Button>
        {job.url && (
          <a
            href={job.url}
            target="_blank"
            rel="noreferrer"
            className={cx(
              "inline-flex h-7 items-center gap-1.5 bg-cta px-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-on-cta transition-opacity hover:opacity-85",
            )}
          >
            Apply <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}
