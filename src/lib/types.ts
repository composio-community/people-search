// Shared between the server (agent loop, reveal route) and the client (chat UI).

export type EmailStatus =
  | "verified"
  | "likely"
  | "unverified"
  | "accept_all"
  | "invalid"
  | "unknown";

export type Job = {
  title?: string;
  company?: string;
  start?: string;
  end?: string;
  current?: boolean;
};

export type Person = {
  key: string;
  apolloId?: string;
  firstName?: string;
  lastName?: string;
  /** Apollo hides last names on free search, e.g. "Cu***s". */
  lastNameHidden?: string;
  name?: string;
  title?: string;
  headline?: string;
  seniority?: string;
  company?: string;
  companyDomain?: string;
  companyLogo?: string;
  location?: string;
  linkedinUrl?: string;
  twitterUrl?: string;
  githubUrl?: string;
  photoUrl?: string;
  email?: string;
  emailStatus?: EmailStatus;
  emailScore?: number;
  phone?: string;
  hasEmail?: boolean;
  hasPhone?: boolean;
  employment?: Job[];
  sources: string[];
  /** True once an enrichment call returned contact data. */
  revealed?: boolean;
  /** Dollars spent on this person so far. */
  spent?: number;
};

export type Company = {
  key: string;
  apolloId?: string;
  name: string;
  domain?: string;
  logoUrl?: string;
  industry?: string;
  employees?: number;
  location?: string;
  founded?: number;
  description?: string;
  linkedinUrl?: string;
  funding?: string;
  sources: string[];
};

export type Price = {
  /** Provider description, e.g. "Estimated $0.02–$0.18 per person enriched". */
  text: string;
  min: number;
  max: number;
  discount: number;
  free: boolean;
};

export type StepInfo = {
  index: number;
  slug: string;
  toolkit: string;
  label: string;
  args: Record<string, unknown>;
  price?: Price;
};

export type StepResult = {
  index: number;
  ok: boolean;
  error?: string;
  summary?: string;
  raw?: string;
};

export type PresentedPerson = { ref?: string; note?: string; person: Person };
export type PresentedCompany = { ref?: string; note?: string; company: Company };

export type IntroHook = { text: string; url?: string; source?: string };

export type IntroDraft = {
  style: "forwardable" | "direct";
  /** Who receives the email: the mutual connection, or the target for a direct note. */
  to?: string;
  /** The person being introduced to, as a ref from tool output. */
  targetRef?: string;
  targetName?: string;
  subject: string;
  body: string;
  hooks: IntroHook[];
};

export type AgentEvent =
  | { type: "status"; text: string }
  /** `reasoning`: raw chain of thought (open models), not a progress update. */
  | { type: "note"; id: string; delta: string; reasoning?: boolean }
  | { type: "text"; id: string; delta: string }
  /** Replaces a text block's content: used to pull back leaked tool-call markup. */
  | { type: "text-retract"; id: string; text: string }
  | { type: "tool-call"; callId: string; name: string }
  /** Arguments of a tool call while the model is still writing them. */
  | { type: "tool-input"; callId: string; name: string; steps: StepInfo[] }
  | {
      type: "tool-start";
      callId: string;
      name: string;
      steps: StepInfo[];
    }
  | {
      type: "tool-end";
      callId: string;
      ok: boolean;
      error?: string;
      blocked?: boolean;
      durationMs: number;
      charge: number;
      steps: StepResult[];
      people: Person[];
      companies: Company[];
      prices?: Record<string, Price>;
    }
  | {
      type: "present";
      callId: string;
      streaming?: boolean;
      title: string;
      summary?: string;
      people: PresentedPerson[];
      companies: PresentedCompany[];
    }
  | { type: "history"; messages: unknown[] }
  | { type: "error"; message: string; code?: "auth" | "config" | "api" }
  | { type: "done"; stopReason: string | null };

export type RevealMode = "email" | "verify";

export type RevealRequest = {
  mode: RevealMode;
  people: Array<
    Pick<
      Person,
      | "key"
      | "apolloId"
      | "firstName"
      | "lastName"
      | "name"
      | "company"
      | "companyDomain"
      | "linkedinUrl"
      | "email"
    >
  >;
};

/** "partial": the provider returned useful details (e.g. a full name) but not the email itself. */
export type AttemptState = "running" | "found" | "partial" | "miss" | "error";

export type RevealAttempt = {
  slug: string;
  toolkit: string;
  state: AttemptState;
  charge?: number;
  ms?: number;
  error?: string;
};

/** Streamed by /api/reveal as each provider is tried. */
export type RevealEvent =
  | { type: "attempt"; key: string; attempt: RevealAttempt }
  | { type: "person"; key: string; ok: boolean; patch?: Partial<Person>; error?: string }
  | { type: "error"; message: string; code?: "auth" }
  | { type: "done"; charge: number };
