// Request parsing for the Songwriting API. Each parser returns either the
// row to write or { error, field, code? } for a 400. Text is trimmed before
// it is written (424 refuses untrimmed language entries with 23514).

import {
  PW_CONTINENTS,
  PW_LEAD_KINDS,
  PW_LEAD_STATUSES,
  PW_NATION_STATUSES,
  PW_TRAINING_STATUSES,
  type PwLeadStatus,
} from "@/lib/departments/db.types";
import { isIsoDate, isUuid } from "@/lib/departments/validate";
import { SW_CODES, type Row } from "./types";

export type Failure = { ok: false; error: string; field?: string; code?: string };
export type Parsed<T> = { ok: true; value: T } | Failure;

const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
const bad = (error: string, field?: string, code?: string): Failure => ({ ok: false, error, field, code });

const NAME_MAX = 200;
const TEXT_MAX = 4000;
const LANGUAGE_MAX = 60;
const LIST_MAX = 30;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

type FieldResult = { ok: true; value: unknown } | { ok: false; error: string; code?: string };
type FieldParser = (v: unknown) => FieldResult;
const fok = (value: unknown): FieldResult => ({ ok: true, value });
const fbad = (error: string, code?: string): FieldResult => ({ ok: false, error, code });

function requiredText(max = NAME_MAX): FieldParser {
  return (v) => {
    if (typeof v !== "string" || !v.trim()) return fbad("is required");
    if (v.trim().length > max) return fbad(`must be ${max} characters or fewer`);
    return fok(v.trim());
  };
}

function optionalText(max = TEXT_MAX): FieldParser {
  return (v) => {
    if (v === null || v === undefined) return fok(null);
    if (typeof v !== "string") return fbad("must be text or null");
    if (v.trim().length > max) return fbad(`must be ${max} characters or fewer`);
    return fok(v.trim() || null);
  };
}

function oneOf(values: readonly string[]): FieldParser {
  return (v) => (typeof v === "string" && values.includes(v) ? fok(v) : fbad(`must be one of ${values.join(", ")}`));
}

function nullableOneOf(values: readonly string[]): FieldParser {
  return (v) => (v === null ? fok(null) : oneOf(values)(v));
}

const optionalUuid: FieldParser = (v) => (v === null || v === undefined ? fok(null) : isUuid(v) ? fok(v) : fbad("must be an id or null"));

function count(v: unknown): FieldResult {
  if (v === null || v === undefined) return fok(null);
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1_000_000 ? fok(v) : fbad("must be a whole number, 0 or more, or null");
}

/** Trimmed, non-blank, de-duplicated (case-insensitive, first spelling kept). */
export function cleanList(v: unknown, max = LIST_MAX, itemMax = LANGUAGE_MAX): FieldResult {
  if (v === null || v === undefined) return fok([]);
  if (!Array.isArray(v)) return fbad("must be a list of text");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    if (typeof item !== "string") return fbad("must be a list of text");
    const t = item.trim().replace(/\s+/g, " ");
    if (!t) continue;
    if (t.length > itemMax) return fbad(`entries must be ${itemMax} characters or fewer`);
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  if (out.length > max) return fbad(`must have ${max} entries or fewer`);
  return fok(out);
}

/** ISO 3166-1 alpha-2. Trimmed and upper-cased; blank is null. */
export function parseIsoCode(v: unknown): FieldResult {
  if (v === null || v === undefined) return fok(null);
  if (typeof v !== "string") return fbad("must be two letters (ISO 3166-1 alpha-2) or null");
  const t = v.trim().toUpperCase();
  if (!t) return fok(null);
  return /^[A-Z]{2}$/.test(t) ? fok(t) : fbad("must be two letters (ISO 3166-1 alpha-2), for example ZA");
}

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const nationSlug: FieldParser = (v) => (typeof v === "string" && SLUG_RE.test(v) && v.length <= 80 ? fok(v) : fbad("must be lower-case letters, digits and dashes"));

/**
 * Runs the parsers for the keys present in body (all required keys must be
 * present when `required` lists them). Unknown keys are ignored; keys in
 * `readOnly` are refused with 400 read_only_field.
 */
function parseFields(
  body: unknown,
  fields: Record<string, FieldParser>,
  opts: { required?: string[]; readOnly?: Record<string, string>; partial: boolean }
): Parsed<Row> {
  if (!isObject(body)) return bad("Send a JSON object");
  for (const [key, why] of Object.entries(opts.readOnly ?? {})) {
    if (key in body) return bad(why, key, SW_CODES.readOnlyField);
  }
  const out: Row = {};
  for (const key of opts.required ?? []) {
    if (!(key in body) || body[key] === undefined) return bad(`${key} is required`, key);
  }
  for (const [key, parse] of Object.entries(fields)) {
    if (!(key in body) || body[key] === undefined) continue;
    const r = parse(body[key]);
    if (!r.ok) return bad(`${key} ${r.error}`, key, r.code);
    out[key] = r.value;
  }
  if (opts.partial && Object.keys(out).length === 0) return bad("Nothing to change");
  return ok(out);
}

// ── Nations ────────────────────────────────────────────────

const NATION_FIELDS: Record<string, FieldParser> = {
  name: requiredText(),
  slug: nationSlug,
  continent: nullableOneOf(PW_CONTINENTS),
  status: oneOf(PW_NATION_STATUSES),
  notes: optionalText(),
  iso_code: parseIsoCode,
  languages: (v) => cleanList(v),
};

export function parseNationCreate(body: unknown): Parsed<Row> {
  const r = parseFields(body, NATION_FIELDS, { required: ["name"], partial: false });
  if (!r.ok) return r;
  if (!r.value.slug) {
    const slug = slugify(String(r.value.name));
    if (!slug) return bad("Give the nation a slug (its name has no letters or digits)", "slug");
    r.value.slug = slug;
  }
  return r;
}

export function parseNationPatch(body: unknown): Parsed<Row> {
  return parseFields(body, NATION_FIELDS, { partial: true });
}

// ── Trainings ──────────────────────────────────────────────

export type FacilitatorInput = { display_name: string; person_id: string | null };

function parseFacilitators(v: unknown): FieldResult {
  if (v === null || v === undefined) return fok([]);
  if (!Array.isArray(v)) return fbad("must be a list of names");
  const out: FacilitatorInput[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    const name = typeof item === "string" ? item : isObject(item) ? item.display_name : undefined;
    const person = isObject(item) ? (item.person_id ?? null) : null;
    if (typeof name !== "string") return fbad("must be a list of names");
    if (person !== null && !isUuid(person)) return fbad("person_id must be an id or null");
    const t = name.trim().replace(/\s+/g, " ");
    if (!t) continue;
    if (t.length > NAME_MAX) return fbad(`names must be ${NAME_MAX} characters or fewer`);
    if (seen.has(t)) continue; // unique (training_id, display_name)
    seen.add(t);
    out.push({ display_name: t, person_id: person as string | null });
  }
  if (out.length > LIST_MAX) return fbad(`must have ${LIST_MAX} names or fewer`);
  return fok(out);
}

function trainingDate(v: unknown): FieldResult {
  if (v === null || v === undefined || v === "") return fok(null);
  // A date, never a timestamp (424: a timestamp is cast in the session zone).
  return typeof v === "string" && isIsoDate(v) ? fok(v) : fbad("must be a date, YYYY-MM-DD, or null");
}

const TRAINING_FIELDS: Record<string, FieldParser> = {
  year: (v) => (Number.isInteger(v) && (v as number) >= 2000 && (v as number) <= 2100 ? fok(v) : fbad("must be a year from 2000 to 2100")),
  month: (v) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 12 ? fok(v) : fbad("must be 1 to 12")),
  training_date: trainingDate,
  audience_label: optionalText(NAME_MAX),
  location_text: optionalText(NAME_MAX),
  nation_id: optionalUuid,
  people_trained: count,
  songs_workshop: count,
  songs_post: count,
  notes: optionalText(),
  languages: (v) => cleanList(v),
  status: oneOf(PW_TRAINING_STATUSES),
  facilitators: parseFacilitators,
};

const TRAINING_READ_ONLY = {
  source: "source is set by the Hub",
  import_key: "import_key is set by the importer",
  created_by: "created_by is set by the Hub",
};

/** True when a YYYY-MM-DD date falls in year/month (424's CHECK). */
export function dateFitsMonth(date: string | null | undefined, year: number, month: number): boolean {
  if (!date) return true;
  const [y, m] = date.split("-").map(Number);
  return y === year && m === month;
}

export type TrainingWrite = { row: Row; facilitators: FacilitatorInput[] | null };

/**
 * POST body: #745's TrainingInput plus optional training_date. year and
 * month are required; training_date must fall inside them (400
 * training_date_outside_month, fieldErrors.training_date).
 */
export function parseTrainingCreate(body: unknown): Parsed<TrainingWrite> {
  const r = parseFields(body, TRAINING_FIELDS, { required: ["year", "month"], readOnly: TRAINING_READ_ONLY, partial: false });
  if (!r.ok) return r;
  const { facilitators, ...row } = r.value;
  if (!dateFitsMonth(row.training_date as string | null, row.year as number, row.month as number)) {
    return bad("training_date must fall in the training's year and month", "training_date", SW_CODES.trainingDateOutsideMonth);
  }
  return ok({ row, facilitators: (facilitators as FacilitatorInput[] | undefined) ?? [] });
}

/**
 * PATCH body: any TrainingInput field, plus training_date. The month rule is
 * checked against the stored row: a PATCH that moves year or month must also
 * move training_date into it, or clear it (null). facilitators, when sent,
 * replace the list.
 */
export function parseTrainingPatch(body: unknown, current: { year: number; month: number; training_date: string | null }): Parsed<TrainingWrite> {
  const r = parseFields(body, TRAINING_FIELDS, { readOnly: TRAINING_READ_ONLY, partial: true });
  if (!r.ok) return r;
  const { facilitators, ...row } = r.value;
  const year = (row.year as number | undefined) ?? current.year;
  const month = (row.month as number | undefined) ?? current.month;
  const date = "training_date" in row ? (row.training_date as string | null) : current.training_date;
  if (!dateFitsMonth(date, year, month)) {
    const moved = !("training_date" in row);
    return bad(
      moved
        ? "This training has a training_date in its old month. Send a new training_date in the new month, or null."
        : "training_date must fall in the training's year and month",
      "training_date",
      SW_CODES.trainingDateOutsideMonth
    );
  }
  return ok({ row, facilitators: facilitators === undefined ? null : (facilitators as FacilitatorInput[]) });
}

// ── Leads ──────────────────────────────────────────────────

const LEAD_FIELDS: Record<string, FieldParser> = {
  label: requiredText(),
  kind: oneOf(PW_LEAD_KINDS),
  contact_user_id: optionalUuid,
  source_training_id: optionalUuid,
  nation_id: optionalUuid,
  note: optionalText(),
  owner_user_id: optionalUuid,
  status: oneOf(PW_LEAD_STATUSES),
};

const LEAD_READ_ONLY = {
  last_contact_at: "last_contact_at comes from logged contacts. Log a contact instead.",
  created_by: "created_by is set by the Hub",
  owner_name: "owner_name comes from owner_user_id",
};

export function parseLeadCreate(body: unknown): Parsed<Row> {
  return parseFields(body, LEAD_FIELDS, { required: ["label"], readOnly: LEAD_READ_ONLY, partial: false });
}

export function parseLeadPatch(body: unknown): Parsed<Row> {
  return parseFields(body, LEAD_FIELDS, { readOnly: LEAD_READ_ONLY, partial: true });
}

export type LeadFilters = {
  status: PwLeadStatus[] | null;
  kind: string | null;
  nation_id: string | null;
  source_training_id: string | null;
  contact_user_id: string | null;
  /** A user id, or "none" for unassigned. ("me" is resolved by the handler.) */
  owner: string | null;
  q: string | null;
  limit: number;
};

export const LEADS_MAX = 500;

/** ?status=new,waiting &kind= &nation_id= &source_training_id= &contact_user_id= &owner=<id>|me|none &q= &limit= */
export function parseLeadFilters(params: URLSearchParams, userId: string): Parsed<LeadFilters> {
  const status = params.get("status");
  let statuses: PwLeadStatus[] | null = null;
  if (status) {
    const list = status.split(",").map((s) => s.trim()).filter(Boolean);
    if (!list.every((s) => (PW_LEAD_STATUSES as readonly string[]).includes(s))) return bad(`status must be ${PW_LEAD_STATUSES.join(", ")}`, "status");
    statuses = list as PwLeadStatus[];
  }
  const kind = params.get("kind");
  if (kind && !(PW_LEAD_KINDS as readonly string[]).includes(kind)) return bad(`kind must be ${PW_LEAD_KINDS.join(", ")}`, "kind");
  const ids: Record<string, string | null> = {};
  for (const key of ["nation_id", "source_training_id", "contact_user_id"]) {
    const v = params.get(key);
    if (v && !isUuid(v)) return bad(`${key} must be an id`, key);
    ids[key] = v || null;
  }
  let owner = params.get("owner") || null;
  if (owner === "me") owner = userId;
  if (owner && owner !== "none" && !isUuid(owner)) return bad("owner must be an id, me or none", "owner");
  const q = (params.get("q") ?? "").trim().slice(0, 100) || null;
  const limitRaw = params.get("limit");
  const limit = limitRaw === null ? LEADS_MAX : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > LEADS_MAX) return bad(`limit must be 1 to ${LEADS_MAX}`, "limit");
  return ok({ status: statuses, kind: kind || null, nation_id: ids.nation_id, source_training_id: ids.source_training_id, contact_user_id: ids.contact_user_id, owner, q, limit });
}

/** For an ilike pattern: escape %, _ and \ so q matches literally. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// ── Lead events ────────────────────────────────────────────

/** POST { note, at? }. at defaults to now; it may be in the past, not more than 5 minutes ahead. */
export function parseEventCreate(body: unknown, now: Date): Parsed<Row> {
  const r = parseFields(
    body,
    {
      note: requiredText(TEXT_MAX),
      at: (v) => {
        if (v === null || v === undefined) return fok(undefined);
        if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(v) || Number.isNaN(Date.parse(v))) return fbad("must be a timestamp (ISO 8601)");
        if (Date.parse(v) > now.getTime() + 5 * 60_000) return fbad("cannot be in the future");
        return fok(new Date(Date.parse(v)).toISOString());
      },
    },
    { required: ["note"], readOnly: { by: "by is set by the Hub" }, partial: false }
  );
  if (!r.ok) return r;
  if (r.value.at === undefined) delete r.value.at;
  return r;
}
