// Legal → Documents — reading a scan. The pure half: what Claude is asked,
// the shape it must answer in, how its answer is stored, and how it is
// matched to documents. The API call itself is in reader.ts.
//
// Rule (docs/legal-documents.md): what is read from a scan is a SUGGESTION.
// Every field is stored with confirmed: false and nothing reaches a
// document until a person ticks it.

import { z } from "zod";

/** The document fields a scan can suggest, in the order the screens show them. */
export const READABLE_FIELDS = [
  "title",
  "holder",
  "issuer",
  "reference_no",
  "issued_on",
  "expires_on",
] as const;
export type ReadableField = (typeof READABLE_FIELDS)[number];

export const FIELD_LABEL: Record<ReadableField | "type_key", string> = {
  type_key: "Type",
  title: "Title",
  holder: "Holder",
  issuer: "Issued by",
  reference_no: "Reference number",
  issued_on: "Issued",
  expires_on: "Expires",
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

const field = (what: string) =>
  z.object({
    value: z.string().nullable().describe(`${what}. null when the scan does not show it.`),
    sure: z
      .boolean()
      .describe("true only when the value is printed clearly on the scan; false when it is partly legible, inferred or guessed."),
  });

const dateField = (what: string) =>
  z.object({
    value: z
      .string()
      .nullable()
      .describe(`${what}, as YYYY-MM-DD. null when the scan does not show it. Never work out a date the scan does not print.`),
    sure: z.boolean().describe("true only when the full date is printed clearly on the scan."),
  });

export const ScanReadingSchema = z.object({
  is_legible: z.boolean().describe("false when the scan is blank, cut off or too blurry to read."),
  document_kind: z.string().describe('What the document is, in a few plain words, e.g. "South African passport", "SARS tax compliance status letter".'),
  type_key: z
    .string()
    .describe("The key of the best matching type from the list in the prompt, or \"none\" when no type fits."),
  summary: z.string().describe("Two or three plain sentences: what this is, whose it is, and what it allows or proves."),
  things_to_watch: z
    .array(z.string())
    .describe(
      "Points the legal officer should act on or know, taken from what the document says: renewal steps it states, conditions, how long before expiry to renew, missing signatures or stamps, mismatched names. Empty when there are none. Never give general legal advice."
    ),
  title: field("A short title for the document, e.g. \"Passport\" or \"Tax compliance status PIN\""),
  holder: field("Who the document belongs to or is issued to"),
  issuer: field("Who issued it"),
  reference_no: field("Its main reference, registration, policy or document number"),
  issued_on: dateField("The issue date"),
  expires_on: dateField("The expiry or valid-until date"),
  text: z.string().describe("Everything printed on the scan, transcribed in reading order. Plain text, no commentary."),
});
export type ScanReading = z.infer<typeof ScanReadingSchema>;

export function readingPrompt(args: {
  today: string;
  folderName: string;
  folderKind: string;
  types: Array<{ key: string; name: string; category: string }>;
}): string {
  const typeLines = args.types.map((t) => `- ${t.key}: ${t.name} (${t.category})`).join("\n");
  return [
    "You are reading one scanned document for the legal officer of Fire and Fragrance South Africa (FFSA), a nonprofit.",
    "Your answer fills a review screen: a person checks every value before anything is saved, so report only what the scan shows.",
    "",
    `Today is ${args.today}. The scan was filed in the folder "${args.folderName}" (${args.folderKind} papers).`,
    "",
    "Document types the Hub knows (use the key in type_key, or \"none\"):",
    typeLines || "- (none yet)",
    "",
    "Rules:",
    "- Copy numbers and names exactly as printed. If a character is unclear, keep your best reading and set sure to false.",
    "- Dates as YYYY-MM-DD. If only a month and year are printed, give null and mention it in things_to_watch.",
    "- If the scan holds several documents, read the main one and say so in things_to_watch.",
    "- In text, transcribe at most the first 8 pages; if there are more, say so in things_to_watch.",
    "- things_to_watch is for what this document says or lacks. Do not give general legal or tax advice.",
  ].join("\n");
}

// ────────────────────────────────────────────────────────────
// STORING — legal_files.extracted_fields
// ────────────────────────────────────────────────────────────

export type StoredField = { value: string; sure: boolean; confirmed: boolean };
export type StoredReading = {
  document_kind?: string;
  summary?: string;
  things_to_watch?: string[];
  is_legible?: boolean;
  fields?: Partial<Record<ReadableField | "type_key", StoredField>>;
  /** Why the last read failed, in words for the person who pressed Read. */
  error?: string;
};

/**
 * What is kept from Claude's answer. Empty values are dropped, dates that
 * are not real YYYY-MM-DD dates are dropped, and a type_key outside the
 * known list is dropped — the review screen never offers something the
 * database would refuse.
 */
export function toStoredReading(r: ScanReading, knownTypeKeys: string[]): StoredReading {
  const fields: StoredReading["fields"] = {};
  for (const key of READABLE_FIELDS) {
    const f = r[key];
    const value = f.value?.trim();
    if (!value) continue;
    if ((key === "issued_on" || key === "expires_on") && !isRealDate(value)) continue;
    fields[key] = { value: value.slice(0, key === "title" || key === "holder" || key === "issuer" ? 200 : 120), sure: f.sure, confirmed: false };
  }
  if (r.type_key && r.type_key !== "none" && knownTypeKeys.includes(r.type_key)) {
    fields.type_key = { value: r.type_key, sure: true, confirmed: false };
  }
  return {
    document_kind: r.document_kind.slice(0, 200),
    summary: r.summary.slice(0, 2000),
    things_to_watch: r.things_to_watch.map((t) => t.slice(0, 500)).slice(0, 12),
    is_legible: r.is_legible,
    fields,
  };
}

export function isRealDate(v: string): boolean {
  if (!YMD.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Marks the given keys confirmed, leaving the rest as they were. */
export function markConfirmed(reading: StoredReading, keys: string[]): StoredReading {
  const fields = { ...(reading.fields ?? {}) };
  for (const k of keys) {
    const f = fields[k as keyof typeof fields];
    if (f) fields[k as keyof typeof fields] = { ...f, confirmed: true };
  }
  return { ...reading, fields };
}

// ────────────────────────────────────────────────────────────
// MATCHING — which existing document is this scan probably of?
// ────────────────────────────────────────────────────────────

type MatchDoc = {
  id: string;
  folder_id: string;
  title: string;
  type_id: string | null;
  reference_no: string | null;
  expires_on: string | null;
  status: string;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The best guess for the document a reading belongs to, in the same folder,
 * or null (= suggest a new document). Strongest first: the same reference
 * number; then the same type, preferring one not yet replaced; then a title
 * that matches. Only ever a suggestion on the review screen.
 */
export function suggestMatch(
  reading: StoredReading,
  folderId: string,
  docs: MatchDoc[],
  typeIdByKey: Map<string, string>
): { documentId: string; why: string } | null {
  const inFolder = docs.filter((d) => d.folder_id === folderId && d.status !== "cancelled");
  const f = reading.fields ?? {};

  const ref = f.reference_no?.value ? norm(f.reference_no.value) : "";
  if (ref.length >= 4) {
    const hit = inFolder.find((d) => d.reference_no && norm(d.reference_no) === ref);
    if (hit) return { documentId: hit.id, why: "Same reference number" };
  }

  const typeId = f.type_key ? typeIdByKey.get(f.type_key.value) : undefined;
  if (typeId) {
    const sameType = inFolder.filter((d) => d.type_id === typeId);
    const live = sameType.filter((d) => d.status !== "superseded");
    // A newer expiry than the one on file means this is a renewal, not the
    // same paper: suggest a new document then.
    const newer = f.expires_on?.value;
    const pick = live.length === 1 ? live[0] : null;
    if (pick && (!newer || !pick.expires_on || newer <= pick.expires_on)) {
      return { documentId: pick.id, why: "Same type" };
    }
  }

  const title = f.title?.value ? norm(f.title.value) : "";
  if (title.length >= 4) {
    const hit = inFolder.filter((d) => norm(d.title) === title && d.status !== "superseded");
    if (hit.length === 1) return { documentId: hit[0].id, why: "Same title" };
  }
  return null;
}
