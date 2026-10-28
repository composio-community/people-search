/**
 * Open models sometimes write a tool call into their text in their native
 * markup instead of the tool-calling interface, e.g. DeepSeek's
 * `<｜DSML｜ invoke name="...">`. The provider then returns it as plain text.
 * TextGuard streams text through but holds back anything that could be the
 * start of such markup, and reports a leak so the turn can be retried.
 */
const MARKERS = [
  "<｜DSML｜",
  "｜DSML｜",
  "<｜tool▁",
  "<|tool_call",
  "<tool_call>",
  "<function_call",
  "<function=",
  "<invoke name=",
];
const LONGEST = Math.max(...MARKERS.map((m) => m.length));

/** A tool call's arguments past this size, or ending in a long whitespace run, are a runaway. */
const MAX_TOOL_INPUT_CHARS = 24_000;
export const isRunaway = (text: string, limit = MAX_TOOL_INPUT_CHARS) =>
  text.length > limit || /\s{300,}$/.test(text);

export function leakIndex(text: string) {
  let at = -1;
  for (const m of MARKERS) {
    const i = text.indexOf(m);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  return at;
}

/** Length of the longest suffix that could still grow into a marker. */
function heldTail(text: string) {
  for (let k = Math.min(LONGEST - 1, text.length); k > 0; k--) {
    const tail = text.slice(-k);
    if (MARKERS.some((m) => m.startsWith(tail))) return k;
  }
  return 0;
}

export class TextGuard {
  private full = "";
  private sent = 0;
  leaked = false;

  /** Characters already passed through. */
  get shown() {
    return this.sent;
  }

  /** Returns text that is safe to show now, or the clean prefix to keep on a leak. */
  push(delta: string): { show?: string; retract?: string } {
    if (this.leaked) return {};
    this.full += delta;
    const at = leakIndex(this.full);
    if (at !== -1) {
      this.leaked = true;
      return { retract: this.full.slice(0, at).trimEnd() };
    }
    const safe = this.full.length - heldTail(this.full);
    if (safe <= this.sent) return {};
    const show = this.full.slice(this.sent, safe);
    this.sent = safe;
    return { show };
  }

  /** Whatever was held back, once the block is complete. */
  flush() {
    if (this.leaked || this.sent >= this.full.length) return "";
    const rest = this.full.slice(this.sent);
    this.sent = this.full.length;
    return rest;
  }
}
