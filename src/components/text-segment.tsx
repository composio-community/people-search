"use client";

import type { ReactNode } from "react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { parseJobsBlock, splitBlocks, type JobsBlock } from "@/lib/blocks";
import { parseIntro } from "@/lib/intro";
import type { IntroDraft } from "@/lib/types";
import { DotMatrix } from "./timeline";
import { cx } from "./ui";

/**
 * Masked surnames like "Ra***o" read as Markdown emphasis; escape their
 * asterisks outside code blocks so they render as written.
 */
function escapeMasks(text: string) {
  return text
    .split(/(```[\s\S]*?(?:```|$))/)
    .map((chunk, i) => (i % 2 ? chunk : chunk.replace(/(\w)(\*{2,})(?=\w)/g, (_, a: string, stars: string) => a + stars.replace(/\*/g, "\\*"))))
    .join("");
}

// Stable references: Streamdown's memo compares these by identity.
const REMEND = { linkMode: "text-only" } as const;
const LINK_SAFETY = { enabled: false };
const ANIMATED = { animation: "blurIn", duration: 260, sep: "word" } as const;

export type RenderBoard = (kind: "people" | "companies", raw: string, open: boolean, id: string) => ReactNode;
export type RenderJobs = (board: JobsBlock, open: boolean) => ReactNode;

/**
 * Reply text as it streams. Prose renders with Streamdown, as in the Composio
 * playground; ```people / ```companies blocks become boards, ```jobs blocks
 * job cards and ```intro blocks email cards, each filling in while the model
 * writes it.
 */
export function TextSegment({
  id,
  text,
  live,
  renderBoard,
  renderJobs,
  renderIntro,
  className,
}: {
  id: string;
  text: string;
  live: boolean;
  renderBoard?: RenderBoard;
  renderJobs?: RenderJobs;
  renderIntro?: (draft: IntroDraft, open: boolean) => ReactNode;
  className?: string;
}) {
  const chunks = splitBlocks(text, live);
  const last = chunks.at(-1);
  return (
    <div className={cx("ps-markdown max-w-none text-[15.5px] leading-[1.7] text-fg", className)}>
      {chunks.map((chunk, i) => {
        const tail = live && i === chunks.length - 1;
        if (chunk.kind === "md") {
          return (
            <Streamdown
              key={`md${i}`}
              className="ps-prose"
              isAnimating={tail}
              animated={tail ? ANIMATED : undefined}
              remend={REMEND}
              linkSafety={LINK_SAFETY}
            >
              {escapeMasks(chunk.text)}
            </Streamdown>
          );
        }
        if (chunk.kind === "intro") {
          return renderIntro ? (
            <div key={`b${chunk.index}`} className="rise my-4">
              {renderIntro(parseIntro(chunk.raw), live && chunk.open)}
            </div>
          ) : null;
        }
        if (chunk.kind === "jobs") {
          return renderJobs ? (
            <div key={`b${chunk.index}`} className="rise my-4">
              {renderJobs(parseJobsBlock(chunk.raw), live && chunk.open)}
            </div>
          ) : null;
        }
        return renderBoard ? (
          <div key={`b${chunk.index}`} className="rise my-4">
            {renderBoard(chunk.kind, chunk.raw, live && chunk.open, `${id}-${chunk.index}`)}
          </div>
        ) : null;
      })}
      {live && (!last || last.kind === "md") && (
        <DotMatrix state="loading" className="mt-2 text-fg-3" label="Writing" />
      )}
    </div>
  );
}
