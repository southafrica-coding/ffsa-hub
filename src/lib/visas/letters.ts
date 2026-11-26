// FFSA's visa letters: the fields a template may use, and filling them in.
//
// Legal writes each letter in the Hub (migration 366). A template is plain
// text, paragraphs separated by a blank line, with:
//   {{field}}                  filled in from the student, the case or legal
//   {{#section}}…{{/section}}  a paragraph legal includes or leaves out per
//                              letter (multiple entries, outreach…)
// No wording lives in this repo; only the field names do.
//
// The passport number is never stored with a letter: {{passport_number}}
// stays in the issued text and is filled in when the PDF is opened
// (fillPassport), for legal and the student only.

export const LETTER_KINDS = ["invitation", "accommodation", "student_status"] as const;
export type LetterKind = (typeof LETTER_KINDS)[number];

export const LETTER_KIND_LABEL: Record<LetterKind, string> = {
  invitation: "Invitation letter",
  accommodation: "Confirmation of accommodation",
  student_status: "Confirmation of student status",
};

export function isLetterKind(v: unknown): v is LetterKind {
  return typeof v === "string" && (LETTER_KINDS as readonly string[]).includes(v);
}

/** Where a field's value comes from. "legal" fields are typed in when issuing. */
export type FieldSource = "letter" | "student" | "case" | "school" | "legal";

export interface LetterField {
  key: string;
  label: string;
  source: FieldSource;
  /** Legal enters a date for it (shown as "24 November 2026"). */
  date?: boolean;
}

export const LETTER_FIELDS: LetterField[] = [
  { key: "letter_date", label: "Date of the letter", source: "letter" },
  { key: "full_name", label: "Student's full name", source: "student" },
  { key: "first_name", label: "Student's first name", source: "student" },
  { key: "last_name", label: "Student's surname", source: "student" },
  { key: "passport_number", label: "Passport number (filled in when the letter is opened)", source: "student" },
  { key: "nationality", label: "Country of citizenship", source: "student" },
  { key: "he_she", label: "he / she", source: "student" },
  { key: "He_She", label: "He / She (start of a sentence)", source: "student" },
  { key: "his_her", label: "his / her", source: "student" },
  { key: "His_Her", label: "His / Her (start of a sentence)", source: "student" },
  { key: "him_her", label: "him / her", source: "student" },
  { key: "visa_from", label: "Visa from (first arrival day)", source: "case", date: true },
  { key: "visa_to", label: "Visa to (last departure day)", source: "case", date: true },
  { key: "school_name", label: "School name", source: "school" },
  { key: "school_start", label: "School start date", source: "school" },
  { key: "school_end", label: "School end date", source: "school" },
  { key: "addressee", label: "Addressed to (e.g. The Ambassador)", source: "legal" },
  { key: "mission_city", label: "Embassy city", source: "legal" },
  { key: "lecture_phase_end", label: "End of the lecture phase", source: "legal", date: true },
  { key: "outreach_return", label: "Return from outreach", source: "legal", date: true },
  { key: "graduation", label: "Graduation", source: "legal", date: true },
  { key: "involvement", label: "What the person will be involved in", source: "legal" },
  { key: "signature_space", label: "Room to sign and stamp", source: "letter" },
];

export interface LetterSection {
  key: string;
  label: string;
}

export const LETTER_SECTIONS: LetterSection[] = [
  { key: "multiple_entries", label: "Ask for multiple entries" },
  { key: "outreach", label: "Outreach paragraph" },
  { key: "offer_undertakings", label: "Offer and undertakings paragraph" },
];

const FIELD_BY_KEY = new Map(LETTER_FIELDS.map((f) => [f.key, f]));
const SECTION_KEYS = new Set(LETTER_SECTIONS.map((s) => s.key));

/** Marker left in the issued text where the signature goes; the PDF leaves room there. */
export const SIGNATURE_MARK = "[[signature_space]]";
const PASSPORT_TOKEN = "{{passport_number}}";

const TOKEN = /\{\{\s*([#/]?)([A-Za-z_]+)\s*\}\}/g;

export interface TemplateUse {
  fields: string[];
  sections: string[];
}

/** The fields and sections a template uses, in order of first use. */
export function templateUses(body: string): TemplateUse {
  const fields: string[] = [];
  const sections: string[] = [];
  for (const m of body.matchAll(TOKEN)) {
    const list = m[1] ? sections : fields;
    if (!list.includes(m[2])) list.push(m[2]);
  }
  return { fields, sections };
}

/**
 * What's wrong with a template, in words for legal. Empty = it can be
 * published. Same rule as the database for the repatriation undertaking.
 */
export function templateProblems(kind: LetterKind, body: string): string[] {
  const problems: string[] = [];
  if (!body.trim()) return ["The letter has no text."];

  const open: string[] = [];
  for (const m of body.matchAll(TOKEN)) {
    const [, mark, key] = m;
    if (!mark) {
      if (!FIELD_BY_KEY.has(key)) problems.push(`{{${key}}} isn't a field the Hub knows.`);
      continue;
    }
    if (!SECTION_KEYS.has(key)) {
      problems.push(`{{${mark}${key}}} isn't a paragraph the Hub knows.`);
      continue;
    }
    if (mark === "#") {
      if (open.length > 0) problems.push(`{{#${key}}} starts inside {{#${open[open.length - 1]}}}; close that first.`);
      open.push(key);
    } else if (open[open.length - 1] === key) {
      open.pop();
    } else {
      problems.push(`{{/${key}}} closes a paragraph that wasn't started.`);
    }
  }
  for (const key of open) problems.push(`{{#${key}}} is never closed with {{/${key}}}.`);

  // Stray braces: a typo like {{full_name} or {full_name}}.
  const leftover = body.replace(TOKEN, "");
  if (/\{\{|\}\}/.test(leftover)) problems.push("Some {{ }} braces don't make a field. Check for typos.");

  if (kind === "invitation" && !/repatriat/i.test(body)) {
    problems.push("An invitation letter must include FFSA's repatriation undertaking.");
  }
  return [...new Set(problems)];
}

/** he / his / him from the profile's gender; "they" when it isn't set. */
export function pronouns(gender: string | null | undefined) {
  const g = (gender ?? "").trim().toLowerCase();
  if (g === "male" || g === "m" || g === "man") return { he_she: "he", his_her: "his", him_her: "him" };
  if (g === "female" || g === "f" || g === "woman") return { he_she: "she", his_her: "her", him_her: "her" };
  return { he_she: "they", his_her: "their", him_her: "them" };
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "24 November 2026" from "2026-11-24". Empty for anything else. */
export function longDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "";
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : "";
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export interface LetterStudent {
  first_name: string | null;
  last_name: string | null;
  gender: string | null;
  nationality: string | null;
}

export interface LetterSchool {
  name: string;
  start_date: string | null;
  end_date: string | null;
}

/** What legal enters when issuing: text and date fields, and which paragraphs to include. */
export type LetterInputs = Record<string, string | boolean>;

/** The value of every field for one letter. Missing values are empty strings. */
export function letterValues(args: {
  letterDate: string;
  student: LetterStudent;
  stay: { from: string | null; to: string | null };
  schools: LetterSchool[];
  inputs: LetterInputs;
}): Record<string, string> {
  const { student, stay, schools, inputs } = args;
  const p = pronouns(student.gender);
  const str = (k: string) => (typeof inputs[k] === "string" ? (inputs[k] as string).trim() : "");
  const starts = schools.map((s) => s.start_date).filter((d): d is string => !!d).sort();
  const ends = schools.map((s) => s.end_date).filter((d): d is string => !!d).sort();
  const names = [...new Set(schools.map((s) => s.name.trim()).filter(Boolean))];

  const values: Record<string, string> = {
    letter_date: longDate(args.letterDate),
    first_name: (student.first_name ?? "").trim(),
    last_name: (student.last_name ?? "").trim(),
    full_name: `${student.first_name ?? ""} ${student.last_name ?? ""}`.replace(/\s+/g, " ").trim(),
    passport_number: PASSPORT_TOKEN,
    nationality: (student.nationality ?? "").trim(),
    he_she: p.he_she,
    He_She: cap(p.he_she),
    his_her: p.his_her,
    His_Her: cap(p.his_her),
    him_her: p.him_her,
    // Legal may change the visa dates (full-year buffer dates, say).
    visa_from: longDate(str("visa_from") || stay.from),
    visa_to: longDate(str("visa_to") || stay.to),
    school_name: names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? ""),
    school_start: longDate(starts[0]),
    school_end: longDate(ends[ends.length - 1]),
    signature_space: SIGNATURE_MARK,
  };
  for (const f of LETTER_FIELDS) {
    if (f.source === "legal") values[f.key] = f.date ? longDate(str(f.key)) : str(f.key);
  }
  return values;
}

/**
 * Fills a template in. Sections are kept when legal ticked them and
 * dropped otherwise. `missing` lists fields the template uses that have
 * no value; a letter with any is not issued.
 */
export function renderLetter(
  body: string,
  values: Record<string, string>,
  inputs: LetterInputs
): { text: string; missing: string[] } {
  const withSections = body.replace(
    /\{\{\s*#([A-Za-z_]+)\s*\}\}([\s\S]*?)\{\{\s*\/\1\s*\}\}/g,
    (_all, key: string, inner: string) => (inputs[key] === true ? inner : "")
  );
  const missing: string[] = [];
  const text = withSections.replace(/\{\{\s*([A-Za-z_]+)\s*\}\}/g, (_all, key: string) => {
    const v = values[key];
    if (v === undefined || v === "") {
      if (!missing.includes(key)) missing.push(key);
      return "";
    }
    return v;
  });
  // A dropped section can leave three or more line breaks behind.
  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), missing };
}

/** The issued text with the passport number put in, for the PDF only. */
export function fillPassport(text: string, passportNumber: string | null | undefined): string {
  return text.split(PASSPORT_TOKEN).join((passportNumber ?? "").trim() || "[passport number missing]");
}

/** Paragraphs for the PDF: blank lines split them; single line breaks stay. */
export function letterParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+\n/g, "\n").trim())
    .filter(Boolean);
}

/**
 * The fields legal fills in when issuing this template: the legal fields
 * it uses, the visa dates (prefilled from the stay), and its paragraphs.
 */
export function issueFields(body: string): { fields: LetterField[]; sections: LetterSection[] } {
  const used = templateUses(body);
  const fields = LETTER_FIELDS.filter(
    (f) => used.fields.includes(f.key) && (f.source === "legal" || f.key === "visa_from" || f.key === "visa_to")
  );
  const sections = LETTER_SECTIONS.filter((s) => used.sections.includes(s.key));
  return { fields, sections };
}

/**
 * Legal's inputs from a request body, kept to known keys: strings up to
 * 300 characters (dates as YYYY-MM-DD), booleans for paragraphs. Returns
 * null with a reason when something doesn't fit.
 */
export function cleanInputs(raw: unknown): { inputs: LetterInputs } | { error: string } {
  if (raw === undefined || raw === null) return { inputs: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: "Inputs must be an object" };
  const inputs: LetterInputs = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const field = FIELD_BY_KEY.get(k);
    if (SECTION_KEYS.has(k)) {
      if (typeof v !== "boolean") return { error: `${k} must be true or false` };
      inputs[k] = v;
    } else if (field && (field.source === "legal" || k === "visa_from" || k === "visa_to")) {
      if (typeof v !== "string") return { error: `${field.label} must be text` };
      const t = v.trim();
      if (t.length > 300) return { error: `${field.label} is too long` };
      if (t && field.date && !/^\d{4}-\d{2}-\d{2}$/.test(t)) return { error: `${field.label} must be a date` };
      if (t) inputs[k] = t;
    } else {
      return { error: `Unknown field: ${k}` };
    }
  }
  return { inputs };
}
