import { billsOnlyOnSuccess, KNOWN_PRICES, toolkitName, toolkitOf, formatPrice, formatUsd } from "./catalog";
import type { Person, Price, RevealMode } from "./types";

/**
 * Reveal tries Composio Instant providers one at a time, cheapest first, and
 * stops at the first one that finds an email. Tomba and Hunter only bill when
 * they find one, so a miss costs nothing. Apollo enrichment runs first when
 * the surname is still masked (only Apollo can resolve an Apollo id), and
 * last when the cheaper finders miss.
 */
export type RevealStep = {
  slug: string;
  toolkit: string;
  args: Record<string, unknown>;
  price?: Price;
};

type Who = Pick<
  Person,
  "apolloId" | "firstName" | "lastName" | "name" | "company" | "companyDomain" | "linkedinUrl" | "email"
>;

function fullName(p: Who) {
  if (p.lastName && p.firstName) return `${p.firstName} ${p.lastName}`;
  const n = p.name?.trim();
  return n && n.includes(" ") && !n.includes("*") ? n : undefined;
}

function linkedin(p: Who) {
  if (!p.linkedinUrl) return undefined;
  return p.linkedinUrl.startsWith("http") ? p.linkedinUrl : `https://${p.linkedinUrl}`;
}

const at = (domain?: string, company?: string) =>
  domain ? { domain } : company ? { company } : null;

function candidates(p: Who, mode: RevealMode): Array<Omit<RevealStep, "toolkit" | "price"> | null> {
  if (mode === "verify") {
    return p.email
      ? [
          { slug: "ZEROBOUNCE_VALIDATE_EMAIL", args: { email: p.email } },
          { slug: "HUNTER_EMAIL_VERIFIER", args: { email: p.email } },
        ]
      : [];
  }
  const name = fullName(p);
  const li = linkedin(p);
  const where = at(p.companyDomain, p.company);
  return [
    li ? { slug: "TOMBA_FIND_EMAIL_FROM_LINKEDIN", args: { url: li } } : null,
    name && where ? { slug: "TOMBA_FIND_EMAIL", args: { full_name: name, ...where } } : null,
    name && where ? { slug: "HUNTER_EMAIL_FINDER", args: { full_name: name, ...where } } : null,
    p.apolloId
      ? { slug: "APOLLO_PEOPLE_ENRICHMENT", args: { id: p.apolloId } }
      : li
        ? { slug: "APOLLO_PEOPLE_ENRICHMENT", args: { linkedin_url: li } }
        : null,
  ];
}

/** The next untried provider that can identify this person, or null when out of options. */
export function nextRevealStep(
  p: Who,
  mode: RevealMode,
  tried: ReadonlySet<string>,
  prices: Record<string, Price> = KNOWN_PRICES,
): RevealStep | null {
  for (const c of candidates(p, mode)) {
    if (!c || tried.has(c.slug)) continue;
    return { ...c, toolkit: toolkitOf(c.slug), price: prices[c.slug] ?? KNOWN_PRICES[c.slug] };
  }
  return null;
}

/** What the first attempt costs. */
export function firstRevealPrice(p: Who, prices: Record<string, Price>, mode: RevealMode = "email") {
  return nextRevealStep(p, mode, new Set(), prices)?.price;
}

export type RevealEstimate = {
  /** Cost when the first provider finds it. */
  min: number;
  /** Most it can cost: every earlier provider misses (or bills anyway) and the priciest one finds it. */
  max: number;
  /** One line per provider, in the order they're tried. */
  steps: Array<{ label: string; price: string; onlyIfFound: boolean }>;
};

/**
 * The full price of a reveal, across every provider it may try. A masked
 * Apollo record goes to Apollo first; once Apollo returns the surname, the
 * cheaper finders can run too, so they're counted after it.
 */
export function revealEstimate(
  p: Who,
  prices: Record<string, Price> = KNOWN_PRICES,
  mode: RevealMode = "email",
): RevealEstimate | null {
  const chain = candidates(p, mode).filter((c): c is NonNullable<typeof c> => c !== null);
  if (!chain.length) return null;
  if (mode === "email" && !fullName(p) && (p.companyDomain || p.company)) {
    for (const slug of ["TOMBA_FIND_EMAIL", "HUNTER_EMAIL_FINDER"]) {
      if (!chain.some((c) => c.slug === slug)) chain.push({ slug, args: {} });
    }
  }
  const priced = chain.map((c) => ({ slug: c.slug, price: prices[c.slug] ?? KNOWN_PRICES[c.slug] }));
  let missed = 0;
  let max = 0;
  for (const { price } of priced) {
    max = Math.max(max, missed + (price?.max ?? 0));
    missed += billsOnlyOnSuccess(price) ? 0 : (price?.max ?? 0);
  }
  max = Math.max(max, missed);
  return {
    min: priced[0].price?.min ?? 0,
    max,
    steps: priced.map(({ slug, price }) => ({
      label: `${toolkitName(toolkitOf(slug))}${slug.endsWith("_FROM_LINKEDIN") ? " (LinkedIn)" : ""}`,
      price: formatPrice(price) ?? "price unknown",
      onlyIfFound: billsOnlyOnSuccess(price),
    })),
  };
}

/** The breakdown as one tooltip line. */
export function describeEstimate(e: RevealEstimate) {
  const steps = e.steps.map((s) => `${s.label} ${s.price}${s.onlyIfFound ? " if found" : ""}`).join(" → ");
  return `Tried in order, stopping at the first hit: ${steps}. At most ${formatUsd(e.max)}.`;
}

export function canRevealPerson(p: Who) {
  return nextRevealStep(p, "email", new Set()) !== null;
}
