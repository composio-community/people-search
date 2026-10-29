import type { Price } from "./types";

const TOOLKIT_NAMES: Record<string, string> = {
  apollo: "Apollo",
  hunter: "Hunter",
  contactout: "ContactOut",
  crustdata: "Crustdata",
  limadata: "LimaData",
  serpapi: "SerpApi",
  serper: "Serper",
  exa: "Exa",
  parallel: "Parallel",
  tavily: "Tavily",
  zerobounce: "ZeroBounce",
  peopledatalabs: "People Data Labs",
  companyenrich: "CompanyEnrich",
  scrapecreators: "ScrapeCreators",
  listennotes: "Listen Notes",
  akta: "Akta",
  context_dev: "Context.dev",
  predict_leads: "PredictLeads",
  prospeo: "Prospeo",
  leadmagic: "LeadMagic",
  lusha: "Lusha",
  tomba: "Tomba",
  icypeas: "Icypeas",
  openalex: "OpenAlex",
  firecrawl: "Firecrawl",
  brightdata: "Bright Data",
  browser_use: "Browser Use",
  yousearch: "You.com",
  job_search: "Job Search",
  supadata: "Supadata",
  thecompaniesapi: "The Companies API",
  linkedin: "LinkedIn",
  gmail: "Gmail",
  composio: "Composio",
};

// Instant toolkits whose slug has an underscore, so "CONTEXT_DEV_SEARCH_NEWS"
// maps to context_dev rather than "context".
const MULTI_WORD_TOOLKITS = [
  "accu_weather", "alpha_vantage", "api_ninjas", "api_sports", "artificial_analysis",
  "browser_use", "context_dev", "eodhd_apis", "fal_ai", "fish_audio", "google_maps",
  "htmlcss_to_image", "ignav_flights", "ipinfo_io", "job_search", "just_one_api",
  "logo_dev", "luma_labs", "mistral_ai", "openweb_ninja", "pdf_co", "predict_leads",
  "tik_hub", "twelve_data", "web3_career",
];

const META_LABELS: Record<string, string> = {
  COMPOSIO_SEARCH_TOOLS: "Finding the right tools",
  COMPOSIO_GET_TOOL_SCHEMAS: "Reading tool schemas",
  COMPOSIO_MULTI_EXECUTE_TOOL: "Running tools",
  COMPOSIO_MANAGE_CONNECTIONS: "Checking connections",
  COMPOSIO_REMOTE_WORKBENCH: "Processing in workbench",
};

export function toolkitOf(slug: string) {
  if (slug.startsWith("COMPOSIO_")) return "composio";
  const lower = slug.toLowerCase();
  const multi = MULTI_WORD_TOOLKITS.find((t) => lower.startsWith(`${t}_`));
  return multi ?? lower.split("_")[0];
}

export function toolkitName(toolkit: string) {
  return (
    TOOLKIT_NAMES[toolkit] ?? toolkit.charAt(0).toUpperCase() + toolkit.slice(1)
  );
}

export function toolkitLogo(toolkit: string) {
  return `https://logos.composio.dev/api/${toolkit}`;
}

export function actionLabel(slug: string) {
  if (META_LABELS[slug]) return META_LABELS[slug];
  const prefix = toolkitOf(slug).split("_").length;
  const parts = slug.split("_").slice(prefix).join(" ").toLowerCase();
  return parts.charAt(0).toUpperCase() + parts.slice(1);
}

/** "Estimated $0.02–$0.18 per person enriched" with a 50% discount → 0.01–0.09. */
export function parsePrice(description: string, discount = 0): Price {
  const amounts = [...description.matchAll(/\$\s?(\d+(?:\.\d+)?)/g)].map((m) =>
    parseFloat(m[1]),
  );
  // "$0.005 per 10 requests" is $0.0005 a request.
  const batch = /\bper\s+(\d[\d,]*)\s+[a-z]/i.exec(description);
  const perUnit = batch ? Math.max(1, parseInt(batch[1].replace(/,/g, ""), 10)) : 1;
  const factor = (1 - Math.min(Math.max(discount, 0), 100) / 100) / perUnit;
  const min = (amounts[0] ?? 0) * factor;
  const max = (amounts[1] ?? amounts[0] ?? 0) * factor;
  return { text: description, min, max, discount, free: max === 0 && amounts.length > 0 };
}

/** Pull per-tool Instant prices out of a COMPOSIO_SEARCH_TOOLS response. */
export function pricesFromSearch(json: unknown): Record<string, Price> {
  const out: Record<string, Price> = {};
  const statuses = (json as { data?: { toolkit_connection_statuses?: unknown[] } })?.data
    ?.toolkit_connection_statuses;
  if (!Array.isArray(statuses)) return out;
  for (const s of statuses) {
    const prices = (s as { instant_account?: { prices?: Record<string, unknown> } })
      ?.instant_account?.prices;
    if (!prices) continue;
    for (const [slug, p] of Object.entries(prices)) {
      const entry = p as { description?: string; discount?: string | number };
      if (!entry?.description) continue;
      out[slug] = parsePrice(entry.description, Number(entry.discount ?? 0) || 0);
    }
  }
  return out;
}

/**
 * Dollars at the precision Instant bills in: four decimals under a cent
 * ($0.0015), three under a dollar ($0.012, $0.18), cents above. Pass
 * `digits` to force a fixed precision.
 */
export function formatUsd(n: number, digits?: number) {
  if (!n) return "$0";
  if (digits !== undefined) return `$${n.toFixed(digits)}`;
  const fixed = n.toFixed(n < 0.01 ? 4 : n < 1 ? 3 : 2);
  const [whole, frac = ""] = fixed.split(".");
  return `$${whole}.${frac.replace(/0+$/, "").padEnd(2, "0")}`;
}

/** "$0.0015", "$0.02–0.18", or "FREE". */
export function formatRange(min: number, max: number) {
  if (max === 0) return "FREE";
  if (Math.abs(max - min) < 0.00005) return formatUsd(max);
  return `${formatUsd(min)}–${formatUsd(max).slice(1)}`;
}

export function formatPrice(p?: Price) {
  if (!p) return null;
  if (p.free) return "FREE";
  return formatRange(p.min, p.max);
}

/** Providers like Tomba and Hunter bill only when they find something; a miss is free. */
export function billsOnlyOnSuccess(p?: Price) {
  return Boolean(p && /\b(successful|found)\b/i.test(p.text));
}

/** Fallback prices seen on the Instant catalog (29 Oct 2026), shown until a live search returns them. */
export const KNOWN_PRICES: Record<string, Price> = {
  APOLLO_PEOPLE_SEARCH: parsePrice("$0 per request"),
  APOLLO_PEOPLE_ENRICHMENT: parsePrice(
    "Estimated $0.02–$0.18 per person enriched (1–9 credits; waterfall may cost more)",
  ),
  APOLLO_BULK_PEOPLE_ENRICHMENT: parsePrice(
    "Estimated $0.02–$0.18 per person enriched (1–9 credits; waterfall may cost more)",
  ),
  APOLLO_ORGANIZATION_SEARCH: parsePrice("Estimated $0.02 per organization search page"),
  APOLLO_GET_ORGANIZATION: parsePrice("Estimated $0.02 per organization retrieved"),
  HUNTER_EMAIL_FINDER: parsePrice("$0.024 per email found", 50),
  HUNTER_EMAIL_VERIFIER: parsePrice("$0.012 per billed email verification", 50),
  HUNTER_DOMAIN_SEARCH: parsePrice(
    "$0.024 per billed Domain Search credit (1–10 returned emails)",
    50,
  ),
  HUNTER_EMAIL_COUNT: parsePrice("$0 per request"),
  CONTACTOUT_SEARCH_PEOPLE: parsePrice("Estimated $0.02 per returned profile"),
  TOMBA_FIND_EMAIL: parsePrice("$0.017 per successful email find", 91),
  TOMBA_FIND_EMAIL_FROM_LINKEDIN: parsePrice("$0.017 per successful LinkedIn email find", 91),
  ZEROBOUNCE_VALIDATE_EMAIL: parsePrice("$0.019 per validation credit", 83),
  COMPANYENRICH_SEARCH_PEOPLE: parsePrice("$0.019 per person returned"),
  PEOPLEDATALABS_PEOPLE_SEARCH_ELASTIC: parsePrice("$0.28 per person returned", 10),
};
