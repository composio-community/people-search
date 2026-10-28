import type { Company, EmailStatus, Job, Person } from "./types";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

export function normalizeDomain(input?: string) {
  if (!input) return undefined;
  const d = input
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .trim();
  return d.includes(".") ? d : undefined;
}

export function normalizeLinkedin(url?: string) {
  if (!url) return undefined;
  const u = url
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^([a-z]{2,3}\.)?(www\.)?/, "")
    .split(/[?#]/)[0]
    .replace(/\/+$/, "");
  return u.includes("linkedin.com/") ? u : undefined;
}

function emailStatusOf(v: unknown): EmailStatus | undefined {
  const s = str(v)?.toLowerCase();
  if (!s) return undefined;
  if (["verified", "valid", "deliverable"].includes(s)) return "verified";
  if (s.includes("likely")) return "likely";
  if (["guessed", "unverified", "extrapolated"].includes(s)) return "unverified";
  if (["accept_all", "catch_all", "catch-all", "risky", "webmail"].includes(s)) return "accept_all";
  if (["invalid", "undeliverable", "bounced", "disposable"].includes(s)) return "invalid";
  if (["unknown", "unavailable"].includes(s)) return "unknown";
  return undefined;
}

function cleanEmail(v: unknown) {
  const e = str(v)?.toLowerCase();
  // Apollo returns this placeholder for locked emails.
  if (!e || !e.includes("@") || e.startsWith("email_not_unlocked")) return undefined;
  return e;
}

function firstEmail(o: Obj) {
  const direct = cleanEmail(o.email) ?? cleanEmail(o.work_email);
  if (direct) return direct;
  if (str(o.value)?.includes("@")) return cleanEmail(o.value);
  for (const field of ["emails", "work_emails", "contact_emails"]) {
    const list = o[field];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const e = cleanEmail(isObj(item) ? (item.email ?? item.value ?? item.address) : item);
      if (e) return e;
    }
  }
  return undefined;
}

function firstPhone(o: Obj) {
  const direct =
    str(o.sanitized_phone) ?? str(o.phone_number) ?? str(o.mobile_phone) ?? str(o.phone);
  if (direct) return direct;
  for (const field of ["phone_numbers", "phones"]) {
    const list = o[field];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const p = isObj(item)
        ? (str(item.sanitized_number) ?? str(item.raw_number) ?? str(item.number) ?? str(item.value))
        : str(item);
      if (p) return p;
    }
  }
  return undefined;
}

function joinLocation(o: Obj) {
  const direct = str(o.location) ?? str(o.formatted_address);
  if (direct) return direct;
  const parts = [o.city, o.state, o.country].map(str).filter(Boolean);
  return parts.length ? [...new Set(parts)].join(", ") : undefined;
}

function isPersonLike(o: Obj) {
  const name =
    str(o.first_name) ??
    str(o.firstName) ??
    str(o.full_name) ??
    (str(o.name)?.includes(" ") && !o.primary_domain && !o.website_url ? str(o.name) : undefined);
  if (!name) return false;
  return Boolean(
    o.title ??
      o.position ??
      o.headline ??
      o.job_title ??
      o.current_title ??
      o.email ??
      o.linkedin_url ??
      o.linkedin ??
      o.organization ??
      o.company ??
      o.company_name ??
      o.last_name_obfuscated,
  );
}

function isCompanyLike(o: Obj) {
  if (o.first_name || o.last_name || o.full_name) return false;
  const name = str(o.name) ?? str(o.company_name) ?? str(o.organization_name);
  const site =
    str(o.primary_domain) ?? str(o.domain) ?? str(o.website_url) ?? str(o.website);
  return Boolean(name && site);
}

type Ctx = { domain?: string; company?: string };

export function toPerson(o: Obj, toolkit: string, ctx: Ctx = {}): Person {
  const org = isObj(o.organization) ? o.organization : isObj(o.company) ? o.company : undefined;
  let firstName = str(o.first_name) ?? str(o.firstName);
  let lastName = str(o.last_name) ?? str(o.lastName);
  let lastNameHidden = lastName ? undefined : str(o.last_name_obfuscated);
  let name = str(o.full_name) ?? str(o.name);
  if (name && !firstName) {
    const [head, ...rest] = name.split(/\s+/);
    firstName = head;
    lastName ??= rest.join(" ") || undefined;
  }
  // A masked surname ("Cu***s") is not a real last name.
  if (lastName?.includes("*")) {
    lastNameHidden ??= lastName;
    lastName = undefined;
  }
  if (name?.includes("*")) name = undefined;
  if (!name && firstName && lastName) name = `${firstName} ${lastName}`;

  const employment: Job[] | undefined = Array.isArray(o.employment_history)
    ? o.employment_history.filter(isObj).map((j) => ({
        title: str(j.title),
        company: str(j.organization_name) ?? str(j.company),
        start: str(j.start_date),
        end: str(j.end_date),
        current: j.current === true,
      }))
    : undefined;

  const linkedin = [o.linkedin_url, o.linkedin, o.linkedin_profile_url, o.profile_url]
    .map(str)
    .find((u) => u && /linkedin\.com\//i.test(u));

  const companyDomain = normalizeDomain(
    str(org?.primary_domain) ??
      str(org?.domain) ??
      str(org?.website_url) ??
      str(o.company_domain) ??
      str(o.domain) ??
      ctx.domain,
  );

  const verification = isObj(o.verification) ? o.verification.status : undefined;

  const p: Person = {
    key: "",
    apolloId: toolkit === "apollo" ? (str(o.id) ?? str(o.person_id)) : undefined,
    firstName,
    lastName,
    lastNameHidden,
    name,
    title:
      str(o.title) ??
      str(o.position) ??
      str(o.job_title) ??
      str(o.current_title),
    headline: str(o.headline),
    seniority: str(o.seniority),
    company:
      str(org?.name) ??
      str(o.company) ??
      str(o.company_name) ??
      str(o.organization_name) ??
      ctx.company,
    companyDomain,
    companyLogo: str(org?.logo_url),
    location: joinLocation(o),
    linkedinUrl: linkedin,
    twitterUrl: str(o.twitter_url) ?? str(o.twitter),
    githubUrl: str(o.github_url),
    photoUrl: str(o.photo_url) ?? str(o.profile_picture_url) ?? str(o.profile_picture),
    email: firstEmail(o),
    emailStatus: emailStatusOf(o.email_status ?? verification ?? o.status),
    emailScore: num(o.score) ?? num(o.confidence),
    phone: firstPhone(o),
    hasEmail: o.has_email === true || undefined,
    hasPhone: o.has_direct_phone === "Yes" || o.has_direct_phone === true || undefined,
    employment: employment?.length ? employment : undefined,
    sources: [toolkit],
  };
  if (p.email || p.phone) p.revealed = true;
  p.key = personKey(p);
  return p;
}

export function toCompany(o: Obj, toolkit: string): Company {
  const name = str(o.name) ?? str(o.company_name) ?? str(o.organization_name) ?? "Unknown";
  const domain = normalizeDomain(
    str(o.primary_domain) ?? str(o.domain) ?? str(o.website_url) ?? str(o.website),
  );
  const stage = str(o.latest_funding_stage);
  const total = str(o.total_funding_printed);
  const c: Company = {
    key: "",
    apolloId: toolkit === "apollo" ? (str(o.organization_id) ?? str(o.id)) : undefined,
    name,
    domain,
    logoUrl: str(o.logo_url) ?? str(o.logo),
    industry:
      str(o.industry) ?? (Array.isArray(o.industries) ? str(o.industries[0]) : undefined),
    employees: num(
      o.estimated_num_employees ?? o.employee_count ?? o.employees ?? o.num_employees,
    ),
    location: joinLocation(o),
    founded: num(o.founded_year),
    description: str(o.short_description) ?? str(o.description),
    linkedinUrl: str(o.linkedin_url),
    funding: [stage, total].filter(Boolean).join(" · ") || undefined,
    sources: [toolkit],
  };
  c.key = companyKey(c);
  return c;
}

export function personKey(p: Partial<Person>) {
  if (p.apolloId) return `apollo:${p.apolloId}`;
  const li = normalizeLinkedin(p.linkedinUrl);
  if (li) return `li:${li}`;
  if (p.email) return `email:${p.email.toLowerCase()}`;
  const who = (p.name ?? p.firstName ?? "unknown").toLowerCase();
  const where = (p.companyDomain ?? p.company ?? "").toLowerCase();
  return `name:${who}|${where}`;
}

export function companyKey(c: Partial<Company>) {
  if (c.domain) return `domain:${c.domain}`;
  if (c.apolloId) return `apollo-org:${c.apolloId}`;
  return `company:${(c.name ?? "").toLowerCase()}`;
}

/** Find every person- and company-shaped record in a tool payload. */
export function extractEntities(json: unknown, toolkit: string) {
  const people = new Map<string, Person>();
  const companies = new Map<string, Company>();

  const visit = (v: unknown, depth: number, ctx: Ctx) => {
    if (depth > 9) return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1, ctx);
      return;
    }
    if (!isObj(v)) return;
    // OpenAlex authorship: { author: { id, display_name }, institutions: [...] }
    if (isObj(v.author) && str(v.author.display_name) && Array.isArray(v.institutions)) {
      const inst = v.institutions.find(isObj);
      const p = toPerson(
        { full_name: v.author.display_name, company: inst ? str(inst.display_name) : undefined },
        toolkit,
        ctx,
      );
      const id = str(v.author.id);
      if (id) p.key = `ref:${id}`;
      people.set(p.key, mergePerson(people.get(p.key), p));
      return;
    }
    if (isPersonLike(v)) {
      const p = toPerson(v, toolkit, ctx);
      people.set(p.key, mergePerson(people.get(p.key), p));
      return;
    }
    if (isCompanyLike(v)) {
      const c = toCompany(v, toolkit);
      companies.set(c.key, mergeCompany(companies.get(c.key), c));
      return;
    }
    const next: Ctx = {
      domain: normalizeDomain(str(v.domain)) ?? ctx.domain,
      company: str(v.organization) ?? str(v.company_name) ?? ctx.company,
    };
    for (const [k, child] of Object.entries(v)) {
      // ContactOut keys profiles by their LinkedIn URL.
      if (/linkedin\.com\//i.test(k) && isObj(child) && !child.linkedin_url) {
        visit({ ...child, linkedin_url: k }, depth + 1, next);
      } else {
        visit(child, depth + 1, next);
      }
    }
  };

  visit(json, 0, {});
  return { people: [...people.values()], companies: [...companies.values()] };
}

function pick<T>(next: T | undefined, prev: T | undefined) {
  return next === undefined || next === null || next === "" ? prev : next;
}

export function mergePerson(prev: Person | undefined, next: Partial<Person>): Person {
  if (!prev) return { sources: [], ...next, key: next.key ?? personKey(next) } as Person;
  const out = { ...prev };
  for (const [k, v] of Object.entries(next) as [keyof Person, unknown][]) {
    if (k === "sources" || k === "key" || k === "spent") continue;
    (out as Record<string, unknown>)[k] = pick(v, prev[k]);
  }
  if (out.lastName) out.lastNameHidden = undefined;
  out.sources = [...new Set([...(prev.sources ?? []), ...(next.sources ?? [])])];
  out.revealed = Boolean(prev.revealed || next.revealed);
  return out;
}

export function mergeCompany(prev: Company | undefined, next: Company): Company {
  if (!prev) return next;
  const out = { ...prev };
  for (const [k, v] of Object.entries(next) as [keyof Company, unknown][]) {
    if (k === "sources" || k === "key") continue;
    (out as Record<string, unknown>)[k] = pick(v, prev[k]);
  }
  out.sources = [...new Set([...prev.sources, ...next.sources])];
  return out;
}

export function displayName(p: Person) {
  const first = p.firstName ?? p.name?.split(" ")[0];
  if (p.lastName) return `${first ?? ""} ${p.lastName}`.trim();
  if (p.lastNameHidden) return `${first ?? ""} ${p.lastNameHidden}`.trim();
  return p.name ?? first ?? "Unknown";
}

export function initials(p: Person) {
  const first = p.firstName ?? p.name ?? "?";
  const last = p.lastName ?? p.lastNameHidden ?? "";
  return (first[0] ?? "?").toUpperCase() + (last[0] ?? "").toUpperCase();
}

/** Resolve a reference the model gave (Apollo id, email, LinkedIn URL, or key). */
export function resolvePersonRef(ref: string | undefined, store: Record<string, Person>) {
  if (!ref) return undefined;
  const r = ref.trim();
  const candidates = [
    r,
    `ref:${r}`,
    `apollo:${r}`,
    `email:${r.toLowerCase()}`,
    normalizeLinkedin(r) ? `li:${normalizeLinkedin(r)}` : "",
  ];
  for (const c of candidates) if (c && store[c]) return store[c];
  return undefined;
}

/**
 * Match a person the model described (name, masked surname, company) to one
 * a tool already returned, for models that leave out `ref`.
 */
export function findSimilarPerson(p: Person, store: Record<string, Person>) {
  const first = p.firstName?.toLowerCase();
  if (!first) return undefined;
  const surname = (p.lastName ?? p.lastNameHidden)?.toLowerCase();
  const company = (p.company ?? p.companyDomain)?.toLowerCase();
  const candidates = Object.values(store).filter((s) => {
    if (s.firstName?.toLowerCase() !== first) return false;
    const theirs = (s.lastName ?? s.lastNameHidden)?.toLowerCase();
    if (surname && theirs && surname !== theirs && s.lastNameHidden?.toLowerCase() !== surname) {
      return false;
    }
    if (!company) return true;
    const theirCompany = `${s.company ?? ""} ${s.companyDomain ?? ""}`.toLowerCase();
    return theirCompany.includes(company) || company.includes(s.company?.toLowerCase() ?? "\u0000");
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function resolveCompanyRef(ref: string | undefined, store: Record<string, Company>) {
  if (!ref) return undefined;
  const r = ref.trim();
  const d = normalizeDomain(r);
  const candidates = [r, d ? `domain:${d}` : "", `apollo-org:${r}`, `company:${r.toLowerCase()}`];
  for (const c of candidates) if (c && store[c]) return store[c];
  return undefined;
}
