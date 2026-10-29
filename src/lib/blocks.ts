/**
 * The agent writes boards and intros as fenced blocks inside its reply, so
 * they stream token by token like the prose around them:
 *
 * ```people
 * title: VPs of Engineering at Vercel
 * summary: optional one-line context
 * <ref> | <name> | <why they match>
 * ```
 *
 * ```companies uses the same shape with a domain as the ref; ```jobs is
 * parsed by parseJobsBlock; ```intro by lib/intro.
 */

export type BlockKind = "people" | "companies" | "jobs" | "intro";

export type TextChunk =
  | { kind: "md"; text: string }
  | { kind: BlockKind; raw: string; open: boolean; index: number };

const BLOCK_START = /^\s*```\s*(people|companies|jobs|intro)\s*$/;
const FENCE = /^\s*```/;

/**
 * Splits reply text into markdown and blocks. While `live`, a half-typed
 * opening fence at the very end is held back so it never flashes as a code
 * block.
 */
export function splitBlocks(text: string, live = false): TextChunk[] {
  const lines = text.split("\n");
  if (live) {
    const last = lines.at(-1) ?? "";
    if (/^\s*`{1,3}[a-z]*$/.test(last)) lines.pop();
  }
  const out: TextChunk[] = [];
  let md: string[] = [];
  let block: { kind: BlockKind; lines: string[] } | null = null;
  let otherFence = false;
  let index = 0;

  const flushMd = () => {
    const joined = md.join("\n");
    if (joined.trim()) out.push({ kind: "md", text: joined });
    md = [];
  };

  for (const line of lines) {
    if (block) {
      if (FENCE.test(line) && line.trim() === "```") {
        out.push({ kind: block.kind, raw: block.lines.join("\n"), open: false, index: index++ });
        block = null;
      } else {
        block.lines.push(line);
      }
      continue;
    }
    if (otherFence) {
      md.push(line);
      if (line.trim() === "```") otherFence = false;
      continue;
    }
    const start = BLOCK_START.exec(line);
    if (start) {
      flushMd();
      block = { kind: start[1] as BlockKind, lines: [] };
      continue;
    }
    if (FENCE.test(line)) otherFence = true;
    md.push(line);
  }
  if (block) out.push({ kind: block.kind, raw: block.lines.join("\n"), open: true, index: index++ });
  flushMd();
  return out;
}

export type BoardRow = { ref?: string; name: string; note?: string };
export type BoardBlock = { title: string; summary?: string; rows: BoardRow[] };

/** Parses a people or companies block; the last row may still be half-written. */
export function parseBoardBlock(raw: string): BoardBlock {
  const board: BoardBlock = { title: "", rows: [] };
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, "");
    if (!line) continue;
    const meta = /^(title|summary|note):\s*(.*)$/i.exec(line);
    if (meta && !line.includes("|")) {
      if (meta[1].toLowerCase() === "title") board.title = meta[2].trim();
      else board.summary = meta[2].trim() || undefined;
      continue;
    }
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 2) continue;
    const [ref, name, ...rest] = cells;
    if (!name) continue;
    board.rows.push({ ref: ref || undefined, name, note: rest.join(" | ").trim() || undefined });
  }
  return board;
}

/** Every closed people/companies block in a reply, for adding their rows to the store. */
export function closedBoardBlocks(text: string) {
  return splitBlocks(text).flatMap((c) =>
    (c.kind === "people" || c.kind === "companies") && !c.open
      ? [{ kind: c.kind, board: parseBoardBlock(c.raw) }]
      : [],
  );
}

export type JobRow = {
  company: string;
  domain?: string;
  role?: string;
  location?: string;
  salary?: string;
  posted?: string;
  url?: string;
  note?: string;
};
export type JobsBlock = { title: string; summary?: string; rows: JobRow[] };

const blank = (v?: string) => (v && !/^[-–—]+$|^n\/?a$/i.test(v) ? v : undefined);

/**
 * A ```jobs block, one posting per line:
 * `Company (domain) | Role | Location | Salary | Posted | Posting URL | Why it's a lead`.
 * Missing values are "-"; the last row may still be half-written.
 */
export function parseJobsBlock(raw: string): JobsBlock {
  const board: JobsBlock = { title: "", rows: [] };
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, "");
    if (!line) continue;
    const meta = /^(title|summary|note):\s*(.*)$/i.exec(line);
    if (meta && !line.includes("|")) {
      if (meta[1].toLowerCase() === "title") board.title = meta[2].trim();
      else board.summary = meta[2].trim() || undefined;
      continue;
    }
    const [companyCell = "", role, location, salary, posted, url, ...note] = line.split("|").map((c) => c.trim());
    const company = /^(.*?)\s*\(([a-z0-9.-]+\.[a-z]{2,})\)$/i.exec(companyCell);
    const name = (company?.[1] ?? companyCell).trim();
    if (!name || !blank(role)) continue;
    board.rows.push({
      company: name,
      domain: company?.[2]?.toLowerCase(),
      role: blank(role),
      location: blank(location),
      salary: blank(salary),
      posted: blank(posted),
      url: blank(url) && /^https?:\/\//.test(url!) ? url : undefined,
      note: blank(note.join(" | ").trim()),
    });
  }
  return board;
}
