"use client";

/**
 * Runs before first paint on full page loads. On the client the tag renders as
 * text/plain so React doesn't warn about script tags it would never execute.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
