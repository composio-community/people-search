import type { ComponentProps, ReactNode } from "react";
import { Zap } from "lucide-react";
import { initials } from "@/lib/entities";
import { toolkitLogo, toolkitName } from "@/lib/catalog";
import type { EmailStatus, Person } from "@/lib/types";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
};

/** Primary is a black fill on light / white on dark; secondary is a hairline. */
export function Button({ variant = "secondary", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-mono uppercase tracking-[0.06em] transition-[background,color,box-shadow,transform,opacity] duration-150 active:translate-y-px disabled:opacity-40 disabled:active:translate-y-0",
        size === "sm" && "h-7 px-2.5 text-[11px]",
        size === "md" && "h-9 px-3.5 text-[12px]",
        size === "lg" && "h-12 px-6 text-[13px]",
        variant === "primary" && "bg-cta text-on-cta hover:opacity-85",
        variant === "secondary" &&
          "bg-card text-fg shadow-[inset_0_0_0_1px_var(--hairline)] hover:bg-hover",
        variant === "ghost" && "text-fg-2 hover:bg-hover hover:text-fg",
        className,
      )}
    />
  );
}

export function InstantChip({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-[22px] items-center gap-1 border border-brand-ink/70 px-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-brand-ink",
        className,
      )}
    >
      <Zap className="h-3 w-3" fill="currentColor" strokeWidth={0} />
      Instant
    </span>
  );
}

export function ProviderLogo({ toolkit, size = 18 }: { toolkit: string; size?: number }) {
  return (
    <span
      title={toolkitName(toolkit)}
      className="inline-grid shrink-0 place-items-center overflow-hidden rounded-[5px] bg-white shadow-[inset_0_0_0_1px_rgb(15_15_15/0.08)]"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={toolkitLogo(toolkit)}
        alt=""
        width={size - 6}
        height={size - 6}
        loading="lazy"
      />
    </span>
  );
}

export function Favicon({ domain, name, size = 16 }: { domain?: string; name?: string; size?: number }) {
  if (!domain) {
    return (
      <span
        aria-hidden
        className="inline-grid shrink-0 place-items-center rounded-[4px] bg-hover font-mono text-fg-3 shadow-[inset_0_0_0_1px_var(--line)]"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.6) }}
      >
        {name?.trim()[0]?.toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className="shrink-0 rounded-[4px] bg-white"
    />
  );
}

export function Avatar({ person, size = 36 }: { person: Person; size?: number }) {
  return (
    <span
      className="relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-hover font-mono text-fg-2 shadow-[inset_0_0_0_1px_var(--hairline)]"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.32) }}
    >
      {initials(person)}
      {person.photoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={person.photoUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
      )}
    </span>
  );
}

/** "Cu***s" renders as a redaction bar between the visible letters. */
export function MaskedName({ person }: { person: Person }) {
  const first = person.firstName ?? person.name?.split(" ")[0] ?? "";
  if (person.lastName || !person.lastNameHidden) {
    const full = person.lastName ? `${first} ${person.lastName}` : (person.name ?? first);
    return (
      <span key="full" className={person.lastName && person.revealed ? "unblur" : undefined}>
        {full}
      </span>
    );
  }
  const masked = person.lastNameHidden;
  const m = masked.match(/^([^*]*)(\*+)(.*)$/);
  return (
    <span key="masked" className="inline-flex items-baseline">
      {first}&nbsp;
      {m ? (
        <>
          {m[1]}
          <span
            aria-label="hidden"
            className="mx-px inline-block h-[0.85em] translate-y-[0.1em] rounded-[2px] bg-fg/15"
            style={{ width: `${Math.max(m[2].length, 3) * 0.45}em` }}
          />
          {m[3]}
        </>
      ) : (
        masked
      )}
    </span>
  );
}

const STATUS: Record<EmailStatus, { label: string; tone: string }> = {
  verified: { label: "Verified", tone: "text-success" },
  likely: { label: "Likely", tone: "text-success" },
  unverified: { label: "Unverified", tone: "text-fg-3" },
  accept_all: { label: "Catch-all", tone: "text-warning" },
  invalid: { label: "Invalid", tone: "text-danger" },
  unknown: { label: "Unknown", tone: "text-fg-3" },
};

export function EmailStatusBadge({ status }: { status?: EmailStatus }) {
  if (!status) return null;
  const s = STATUS[status];
  return (
    <span className={cx("mono-label inline-flex items-center gap-1 !text-[10px]", s.tone)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-[4px] px-1 font-mono text-[10px] text-fg-3 shadow-[inset_0_0_0_1px_var(--hairline)]">
      {children}
    </kbd>
  );
}

/** Digits roll to their new value with a CSS transition, no timers needed. */
export function Odometer({ value, digits = 3 }: { value: number; digits?: number }) {
  const chars = value.toFixed(digits).split("");
  return (
    <span className="tabular inline-flex items-baseline font-mono" aria-label={`$${value.toFixed(digits)}`}>
      <span aria-hidden>$</span>
      {chars.map((ch, i) => {
        const fromRight = chars.length - i;
        if (ch === ".") {
          return (
            <span key={`dot-${fromRight}`} aria-hidden>
              .
            </span>
          );
        }
        const d = Number(ch);
        return (
          <span key={`d-${fromRight}`} aria-hidden className="odo-digit">
            <span style={{ transform: `translateY(-${d}em)` }}>
              {Array.from({ length: 10 }, (_, n) => (
                <span key={n} className="block h-[1em] leading-none">
                  {n}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
