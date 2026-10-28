import { extractEntities } from "./entities";
import type { EmailStatus, Person } from "./types";

/**
 * Turns one provider's reveal response into fields for the person. Providers
 * shape their responses differently, so this leans on the generic entity
 * extractor and falls back to finding an email or status anywhere in the data.
 */
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export function findPatch(data: unknown, toolkit: string): Partial<Person> | null {
  const { people } = extractEntities(data, toolkit);
  const person = people.find((p) => p.email) ?? people[0];
  const patch: Partial<Person> = {};
  if (person) {
    const { key: _key, revealed: _revealed, ...rest } = person;
    void _key;
    void _revealed;
    Object.assign(patch, rest);
  }
  if (!patch.email) {
    // Some finders return a bare { email, score } with no name fields.
    const email = deepFind(data, (k, v) => /^(email|value|address)$/i.test(k) && typeof v === "string" && EMAIL_RE.test(v));
    if (typeof email === "string" && !email.toLowerCase().startsWith("email_not_unlocked")) {
      patch.email = email.toLowerCase();
    }
  }
  if (patch.email && !patch.emailStatus) {
    patch.emailStatus = statusFrom(deepFind(data, (k) => /^(status|result|verification_status)$/i.test(k)));
  }
  patch.sources = [toolkit];
  return Object.keys(patch).length > 1 ? patch : null;
}

export function verifyPatch(data: unknown): Partial<Person> | null {
  const raw = deepFind(data, (k, v) => /^(status|result)$/i.test(k) && typeof v === "string");
  const status = statusFrom(raw);
  return status ? { emailStatus: status } : null;
}

function statusFrom(v: unknown): EmailStatus | undefined {
  const s = typeof v === "string" ? v.toLowerCase() : typeof v === "object" && v ? statusFrom((v as { status?: unknown }).status) : undefined;
  if (!s) return undefined;
  if (["valid", "verified", "deliverable"].includes(s)) return "verified";
  if (["catch-all", "catch_all", "accept_all", "risky", "webmail"].includes(s)) return "accept_all";
  if (["invalid", "undeliverable", "disposable", "spamtrap", "abuse", "do_not_mail"].includes(s)) return "invalid";
  if (s === "unknown") return "unknown";
  return undefined;
}

/** Depth-first search for the first value whose key matches. */
function deepFind(v: unknown, match: (key: string, value: unknown) => boolean, depth = 0): unknown {
  if (depth > 8 || !v || typeof v !== "object") return undefined;
  if (Array.isArray(v)) {
    for (const item of v) {
      const hit = deepFind(item, match, depth + 1);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  for (const [k, val] of Object.entries(v)) {
    if (match(k, val)) return val;
  }
  for (const val of Object.values(v)) {
    const hit = deepFind(val, match, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}
