// The nation form's draft and its conversion to NationInput. Pure.

import { PW_CONTINENTS, PW_NATION_STATUSES, type PwContinent, type PwNation, type PwNationStatus } from "@/lib/departments/db.types";
import type { NationInput } from "./types";

export type NationDraft = {
  name: string;
  slug: string;
  continent: string;
  status: PwNationStatus;
  notes: string;
  iso_code: string;
  languages: string[];
};

export const CONTINENT_LABEL: Record<PwContinent, string> = {
  africa: "Africa",
  asia: "Asia",
  europe: "Europe",
  north_america: "North America",
  south_america: "South America",
  oceania: "Oceania",
  antarctica: "Antarctica",
};

export const NATION_STATUS_LABEL: Record<PwNationStatus, string> = {
  active: "Confirmed",
  tentative: "Tentative",
};

export { PW_CONTINENTS, PW_NATION_STATUSES };

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function nationToDraft(n: PwNation | null): NationDraft {
  return {
    name: n?.name ?? "",
    slug: n?.slug ?? "",
    continent: n?.continent ?? "",
    status: n?.status ?? "active",
    notes: n?.notes ?? "",
    iso_code: n?.iso_code ?? "",
    languages: n?.languages ?? [],
  };
}

/**
 * Validates the draft. On create a blank slug is left out (the API makes it
 * from the name); on edit the slug is always sent.
 */
export function nationToInput(d: NationDraft, mode: "create" | "edit"): { input: NationInput } | { fields: string[] } {
  const fields: string[] = [];
  const name = d.name.trim();
  const slug = d.slug.trim();
  const iso = d.iso_code.trim().toUpperCase();
  if (!name || name.length > 200) fields.push("name");
  if ((slug || mode === "edit") && (!SLUG_RE.test(slug) || slug.length > 80)) fields.push("slug");
  if (iso && !/^[A-Z]{2}$/.test(iso)) fields.push("iso_code");
  if (d.continent && !(PW_CONTINENTS as readonly string[]).includes(d.continent)) fields.push("continent");
  const languages = d.languages.map((l) => l.trim().replace(/\s+/g, " ")).filter(Boolean);
  if (languages.some((l) => l.length > 60) || languages.length > 30) fields.push("languages");
  if (d.notes.trim().length > 4000) fields.push("notes");
  if (fields.length) return { fields };
  const input: NationInput = {
    name,
    continent: (d.continent || null) as PwContinent | null,
    status: d.status,
    notes: d.notes.trim() || null,
    iso_code: iso || null,
    languages,
  };
  if (slug) input.slug = slug;
  return { input };
}
