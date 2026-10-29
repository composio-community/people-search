"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Download, Star, X } from "lucide-react";
import { displayName } from "@/lib/entities";
import type { Person } from "@/lib/types";
import { downloadCsv, needsReveal, revealTotal, type BoardActions } from "./board";
import { Avatar, Button, EmailStatusBadge, MaskedName } from "./ui";

export function ListPanel({
  open,
  onClose,
  onClear,
  ...ctx
}: { open: boolean; onClose: () => void; onClear: () => void } & BoardActions) {
  const [copied, setCopied] = useState(false);
  const people = ctx.saved.map((k) => ctx.people[k]).filter((p): p is Person => Boolean(p));
  const pending = people.filter(needsReveal);
  const estimate = revealTotal(pending, ctx.prices);
  const emails = people.map((p) => p.email).filter(Boolean) as string[];

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-fg/10 backdrop-blur-[2px]"
          />
          <motion.aside
            role="dialog"
            aria-label="Saved list"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 34, stiffness: 340 }}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col bg-card shadow-pop"
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="text-[16px] font-medium">
                Your list <span className="ml-1 font-mono text-[12px] font-normal text-fg-3">{people.length}</span>
              </h2>
              <button
                type="button"
                autoFocus
                onClick={onClose}
                aria-label="Close"
                className="grid h-8 w-8 place-items-center text-fg-3 hover:bg-hover hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {people.length === 0 ? (
                <div className="grid h-full place-items-center px-8 text-center">
                  <div>
                    <Star className="mx-auto h-5 w-5 text-fg-4" />
                    <p className="mt-3 text-[14px] leading-6 text-fg-2">
                      Save people from any board to build your shortlist here, then export it as CSV.
                    </p>
                  </div>
                </div>
              ) : (
                <ul>
                  {people.map((p) => (
                    <li
                      key={p.key}
                      onClick={() => ctx.onOpen(p.key)}
                      className="group flex cursor-pointer items-center gap-3 border-b border-line px-5 py-3 hover:bg-hover/70"
                    >
                      <Avatar person={p} size={32} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] leading-5">
                          <MaskedName person={p} />
                        </div>
                        <div className="truncate text-[12.5px] leading-5 text-fg-3">
                          {[p.title, p.company].filter(Boolean).join(" · ")}
                        </div>
                        {p.email && (
                          <div className="flex items-center gap-2 font-mono text-[11.5px] text-fg-2">
                            <span className="truncate">{p.email}</span>
                            <EmailStatusBadge status={p.emailStatus} />
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          ctx.onToggleSave(p.key);
                        }}
                        aria-label={`Remove ${displayName(p)}`}
                        className="grid h-7 w-7 place-items-center text-fg-4 opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {people.length > 0 && (
              <div className="space-y-2 border-t border-line p-4">
                {pending.length > 0 && (
                  <Button
                    variant="primary"
                    className="w-full"
                    onClick={() => ctx.onReveal(pending.map((p) => p.key), "email")}
                  >
                    Reveal {pending.length} · {estimate}
                  </Button>
                )}
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => downloadCsv("people-search-list", people.map((person) => ({ person })))}>
                    <Download className="h-3.5 w-3.5" /> CSV
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={emails.length === 0}
                    onClick={() => {
                      void navigator.clipboard.writeText(emails.join("\n"));
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1400);
                    }}
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Copied" : `${emails.length} emails`}
                  </Button>
                  <Button variant="ghost" onClick={onClear}>
                    Clear
                  </Button>
                </div>
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
