"use client";

import { useState, type Ref } from "react";
import { ArrowRight, Lock, X } from "lucide-react";
import { ComposioMark } from "./logos";

/**
 * Asks a visitor to sign in with Composio before their first search. A native
 * <dialog> opened with showModal() from the click that needs it, so focus,
 * Escape and the backdrop come from the browser. The search they typed rides
 * along through sign-in and runs as soon as they're back.
 */
export function SignInDialog({ ref, prompt }: { ref: Ref<HTMLDialogElement>; prompt: string | null }) {
  const [leaving, setLeaving] = useState(false);
  const href = prompt ? `/api/auth/login?q=${encodeURIComponent(prompt)}` : "/api/auth/login";

  return (
    <dialog
      ref={ref}
      aria-labelledby="sign-in-title"
      // A click on the backdrop lands on the dialog itself; inside clicks land on its children.
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
      className="m-auto w-[min(460px,calc(100vw-32px))] bg-card p-0 text-fg shadow-pop backdrop:bg-black/60 backdrop:backdrop-blur-[2px] open:animate-[rise_.35s_var(--ease-out-expo)_both]"
    >
      <div className="p-6 sm:p-7">
        <div className="flex items-start justify-between">
          <span className="grid h-10 w-10 place-items-center bg-fg text-bg">
            <ComposioMark className="h-5 w-5" />
          </span>
          <form method="dialog">
            <button
              type="submit"
              aria-label="Close"
              className="grid h-8 w-8 place-items-center text-fg-3 transition-colors hover:bg-hover hover:text-fg"
            >
              <X className="h-4 w-4" />
            </button>
          </form>
        </div>

        <h2 id="sign-in-title" className="mt-5 text-[24px] leading-tight tracking-[-0.02em]">
          Sign in with Composio
        </h2>
        <p className="mt-2 text-[14.5px] leading-6 text-fg-2">
          People Search runs on your Composio account. Candidate searches start free and work emails cost a few cents
          each, billed to your Composio wallet. You see each price before anything runs.
        </p>

        {prompt && (
          <div className="mt-5 bg-bg px-4 py-3 shadow-[inset_0_0_0_1px_var(--line)]">
            <div className="mono-label text-fg-3">Your search</div>
            <p className="mt-1 line-clamp-3 text-[14.5px] leading-6">{prompt}</p>
            <p className="mt-1.5 text-[12.5px] text-fg-3">Runs as soon as you&apos;re back.</p>
          </div>
        )}

        <a
          href={href}
          data-autofocus
          onClick={() => setLeaving(true)}
          className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 bg-cta font-mono text-[12.5px] uppercase tracking-[0.08em] text-on-cta transition-opacity hover:opacity-90"
        >
          {leaving ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-on-cta/40 border-t-on-cta" />
          ) : (
            <ComposioMark className="h-3.5 w-3.5" />
          )}
          Continue with Composio
          <ArrowRight className="h-4 w-4" />
        </a>
        <form method="dialog">
          <button
            type="submit"
            className="mt-2 h-10 w-full font-mono text-[12px] uppercase tracking-[0.08em] text-fg-3 transition-colors hover:text-fg"
          >
            Not now
          </button>
        </form>
      </div>

      <p className="flex items-center gap-2 border-t border-line px-6 py-3 text-[12px] leading-5 text-fg-3 sm:px-7">
        <Lock className="h-3.5 w-3.5 shrink-0" />
        Signs you in through connect.composio.dev. This app never sees your password.
      </p>
    </dialog>
  );
}
