import { toCompany, toPerson } from "./entities";
import type { PresentedCompany, PresentedPerson } from "./types";

type Loose = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const objs = (v: unknown) =>
  Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Loose[]) : [];

/**
 * Board contents from a present_results call's input. Works on the partial
 * input while the model is still writing it, so rows appear as they stream.
 */
export function presentPicks(input: unknown): {
  title: string;
  summary?: string;
  people: PresentedPerson[];
  companies: PresentedCompany[];
} {
  const i = (input && typeof input === "object" ? input : {}) as Loose;
  return {
    title: str(i.title) ?? "",
    summary: str(i.summary),
    people: objs(i.people)
      .filter((p) => str(p.name))
      .map((p) => {
        const person = toPerson(
          {
            name: str(p.name),
            title: str(p.title),
            company: str(p.company),
            company_domain: str(p.company_domain),
            location: str(p.location),
            linkedin_url: str(p.linkedin_url),
            email: str(p.email),
            email_status: str(p.email_status),
          },
          "agent",
        );
        return { ref: str(p.ref), note: str(p.note), person: { ...person, sources: [] } };
      }),
    companies: objs(i.companies)
      .filter((c) => str(c.name))
      .map((c) => {
        const ref = str(c.ref);
        const company = toCompany(
          {
            name: str(c.name),
            domain: str(c.domain) ?? (ref?.includes(".") ? ref : undefined),
            industry: str(c.industry),
            estimated_num_employees: typeof c.employees === "number" ? c.employees : undefined,
            location: str(c.location),
          },
          "agent",
        );
        return { ref, note: str(c.note), company: { ...company, sources: [] } };
      }),
  };
}
