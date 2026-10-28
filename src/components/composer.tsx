"use client";

import type { Ref } from "react";
import { ArrowRight, Square } from "lucide-react";
import { cx } from "./ui";

const CAPS = [
  { value: 0, label: "Free only" },
  { value: 0.25, label: "$0.25" },
  { value: 1, label: "$1" },
  { value: 5, label: "$5" },
];

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  budget: number;
  onBudget: (v: number) => void;
  inputRef?: Ref<HTMLTextAreaElement>;
  autoFocus?: boolean;
  placeholder?: string;
  model?: string;
  /** "hero" is the large search field on the start screen. */
  variant?: "hero" | "chat";
  /** Shown beside the spend cap in place of the model, e.g. that sending asks a visitor to sign in. */
  note?: string;
};

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  budget,
  onBudget,
  inputRef,
  autoFocus,
  model,
  variant = "chat",
  note,
  placeholder = "Describe who you're looking for…",
}: Props) {
  const hero = variant === "hero";
  const canSend = value.trim().length > 0;
  const button = hero ? "h-10 px-3 text-[12px] sm:px-4" : "h-9 px-3.5 text-[11.5px]";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && canSend) onSend();
      }}
      className="w-full"
    >
      <div
        className={cx(
          "flex items-end gap-1.5 p-1 shadow-[inset_0_0_0_1px_var(--line)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_var(--brand-ink),0_0_0_4px_color-mix(in_oklab,var(--brand-ink)_16%,transparent)]",
          hero ? "bg-bg" : "bg-card",
        )}
      >
        <textarea
          ref={inputRef}
          autoFocus={autoFocus}
          value={value}
          rows={1}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!busy && canSend) onSend();
            }
          }}
          placeholder={placeholder}
          aria-label="Who are you looking for?"
          className={cx(
            "block max-h-[200px] w-full resize-none bg-transparent text-fg outline-none [field-sizing:content] placeholder:text-fg-4",
            hero ? "min-h-10 px-3 py-2 text-[16px] leading-6" : "min-h-9 px-2.5 py-1.5 text-[15px] leading-6",
          )}
        />
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            className={cx(
              "inline-flex shrink-0 items-center gap-2 bg-cta font-mono uppercase tracking-[0.08em] text-on-cta transition-opacity hover:opacity-85",
              button,
            )}
          >
            <Square className="h-3 w-3" fill="currentColor" /> Stop
          </button>
        ) : (
          <button
            type="submit"
            className={cx(
              "group/send inline-flex shrink-0 items-center gap-2 bg-cta font-mono uppercase tracking-[0.08em] text-on-cta transition-[opacity,transform] hover:opacity-90 active:translate-y-px disabled:opacity-30",
              button,
            )}
          >
            <span className={cx(hero && "sr-only sm:not-sr-only")}>{hero ? "Search" : "Send"}</span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover/send:translate-x-0.5" />
          </button>
        )}
      </div>

      <div className={cx("flex flex-wrap items-center justify-between gap-x-4 gap-y-2", hero ? "mt-3" : "mt-2")}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="mono-label text-fg-3">Spend cap</span>
          <div
            role="radiogroup"
            aria-label="Spending cap per request"
            className="flex items-center p-0.5 shadow-[inset_0_0_0_1px_var(--line)]"
          >
            {CAPS.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={budget === c.value}
                onClick={() => onBudget(c.value)}
                className={cx(
                  "h-6 px-2 font-mono text-[11px] transition-colors",
                  budget === c.value ? "bg-brand-wash text-brand-ink" : "text-fg-3 hover:text-fg",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        {note ? (
          <span className="text-[12.5px] text-fg-3">{note}</span>
        ) : (
          model && (
            <span className="mono-label hidden text-fg-4 sm:inline" title="Model running the agent">
              {model}
            </span>
          )
        )}
      </div>
    </form>
  );
}
