"use client";

import { Moon, Sun } from "lucide-react";
import { cx } from "./ui";

export function ThemeToggle({ className }: { className?: string }) {
  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => {
        const root = document.documentElement;
        const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
        root.setAttribute("data-theme", next);
        try {
          localStorage.setItem("ps-theme", next);
        } catch {
          // Private mode: the choice just won't persist.
        }
      }}
      className={cx(
        "grid h-9 w-9 place-items-center text-fg-2 transition-colors hover:bg-hover hover:text-fg",
        className,
      )}
    >
      <Sun className="hidden h-4 w-4 dark:block" />
      <Moon className="h-4 w-4 dark:hidden" />
    </button>
  );
}
