// Embassy profiles (migration 500): checking what legal types in, and the
// short facts the case page and the student see. The database checks the
// same limits; this gives a readable answer first.

import { countries } from "@/lib/countries";

export interface Embassy {
  id: string;
  country_iso: string;
  name: string;
  city: string;
  addressee: string | null;
  accepts_scan: boolean | null;
  needs_original: boolean | null;
  blank_pages: number | null;
  processing_weeks: number | null;
  appointment_weeks: number | null;
  website_url: string | null;
  notes: string | null;
  is_active: boolean;
}

export type EmbassyInput = Omit<Embassy, "id">;

const COUNTRY_NAME = new Map(countries.map((c) => [c.iso2, c.name]));

export function countryName(iso: string): string {
  return COUNTRY_NAME.get(iso) ?? iso;
}

/** "South African High Commission, Testville (Testland)" */
export function embassyLabel(e: Pick<Embassy, "name" | "city" | "country_iso">): string {
  return `${e.name}, ${e.city} (${countryName(e.country_iso)})`;
}

function text(v: unknown, max: number): string | null | undefined {
  if (v == null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (t.length > max) return undefined;
  return t ? t : null;
}

function int(v: unknown, min: number, max: number): number | null | undefined {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) return undefined;
  return n;
}

function yesNo(v: unknown): boolean | null | undefined {
  if (v == null || v === "") return null;
  return typeof v === "boolean" ? v : undefined;
}

/** What legal sent, checked; or the first problem in words. */
export function cleanEmbassy(body: unknown): { data: EmbassyInput } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const country = typeof b.country_iso === "string" ? b.country_iso.trim().toUpperCase() : "";
  if (!COUNTRY_NAME.has(country)) return { error: "Pick the country the embassy is in" };
  const name = text(b.name, 200);
  if (!name) return { error: "Give the embassy's name" };
  const city = text(b.city, 100);
  if (!city) return { error: "Give the city" };
  const addressee = text(b.addressee, 200);
  if (addressee === undefined) return { error: "The addressee is too long" };
  const notes = text(b.notes, 4000);
  if (notes === undefined) return { error: "The notes are too long" };
  const website = text(b.website_url, 500);
  if (website === undefined || (website && !/^https:\/\/\S+$/.test(website))) {
    return { error: "The link must start with https://" };
  }
  const blank = int(b.blank_pages, 0, 10);
  if (blank === undefined) return { error: "Blank pages must be a whole number from 0 to 10" };
  const processing = int(b.processing_weeks, 1, 52);
  if (processing === undefined) return { error: "Processing time must be 1 to 52 weeks" };
  const appointment = int(b.appointment_weeks, 0, 26);
  if (appointment === undefined) return { error: "Appointment wait must be 0 to 26 weeks" };
  const scan = yesNo(b.accepts_scan);
  const original = yesNo(b.needs_original);
  if (scan === undefined || original === undefined) return { error: "Scan and original must be yes, no or not known" };
  const active = b.is_active == null ? true : b.is_active;
  if (typeof active !== "boolean") return { error: "is_active must be true or false" };
  return {
    data: {
      country_iso: country,
      name,
      city,
      addressee,
      accepts_scan: scan,
      needs_original: original,
      blank_pages: blank,
      processing_weeks: processing,
      appointment_weeks: appointment,
      website_url: website,
      notes,
      is_active: active,
    },
  };
}

/** Short lines for the case page and the student: only what's known. */
export function embassyFacts(e: Embassy): string[] {
  const facts: string[] = [];
  if (e.needs_original === true) facts.push("Take the original signed letters; a scan isn't enough.");
  else if (e.accepts_scan === true) facts.push("A scan of the signed letters is accepted.");
  else if (e.accepts_scan === false) facts.push("A scan isn't accepted; take the original signed letters.");
  if (e.blank_pages != null && e.blank_pages > 0) {
    facts.push(`The passport needs ${e.blank_pages} blank page${e.blank_pages === 1 ? "" : "s"}.`);
  }
  if (e.processing_weeks != null) {
    const wait = e.appointment_weeks ? `, plus about ${e.appointment_weeks} for an appointment` : "";
    facts.push(`Processing takes about ${e.processing_weeks} week${e.processing_weeks === 1 ? "" : "s"}${wait}.`);
  } else if (e.appointment_weeks) {
    facts.push(`Getting an appointment takes about ${e.appointment_weeks} weeks.`);
  }
  return facts;
}

/** The letter fields an embassy fills in for legal when issuing. */
export function embassyLetterDefaults(e: Pick<Embassy, "addressee" | "city"> | null): Record<string, string> {
  if (!e) return {};
  const out: Record<string, string> = { mission_city: e.city };
  if (e.addressee) out.addressee = e.addressee;
  return out;
}
