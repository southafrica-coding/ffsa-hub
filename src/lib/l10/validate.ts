// Request body parsing for the L10 API. Parsers return the exact columns to
// write, so the route never passes caller keys straight to the database.

import { isIsoDate, isUuid } from "@/lib/departments/validate";
import {
  L10_GOAL_DIRECTIONS,
  L10_ISSUE_STATUSES,
  L10_MEASURABLE_UNITS,
  L10_RATING_MAX,
  L10_RATING_MIN,
  L10_SEGMENTS,
  ROCK_STATUSES,
  type L10ItemKind,
  type L10Segment,
} from "./types";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
export type Row = Record<string, unknown>;

const TITLE_MAX = 200;
const TEXT_MAX = 4000;
const HEADLINE_MAX = 1000;
const QUARTER_RE = /^\d{4}-Q[1-4]$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

type Field = (value: unknown) => Parsed<unknown>;

function requiredText(name: string, max: number): Field {
  return (value) => {
    if (typeof value !== "string" || value.trim() === "") return { ok: false, error: `${name} is required` };
    const t = value.trim();
    if (t.length > max) return { ok: false, error: `${name} must be ${max} characters or fewer` };
    return { ok: true, value: t };
  };
}

const title = requiredText("title", TITLE_MAX);

/** A Monday, as l10_measurable_values.week_start requires. */
const monday: Field = (value) => {
  if (typeof value !== "string" || !isIsoDate(value) || new Date(`${value}T00:00:00Z`).getUTCDay() !== 1) {
    return { ok: false, error: "week_start must be a Monday (YYYY-MM-DD)" };
  }
  return { ok: true, value };
};

const requiredUuid: (name: string) => Field = (name) => (value) =>
  isUuid(value) ? { ok: true, value } : { ok: false, error: `${name} must be a uuid` };

function optionalText(name: string, max: number): Field {
  return (value) => {
    if (value === null || value === undefined) return { ok: true, value: null };
    if (typeof value !== "string") return { ok: false, error: `${name} must be text` };
    const t = value.trim();
    if (t.length > max) return { ok: false, error: `${name} must be ${max} characters or fewer` };
    return { ok: true, value: t === "" ? null : t };
  };
}

function optionalUuid(name: string): Field {
  return (value) => {
    if (value === null || value === undefined) return { ok: true, value: null };
    return isUuid(value) ? { ok: true, value } : { ok: false, error: `${name} must be a uuid` };
  };
}

function optionalDate(name: string): Field {
  return (value) => {
    if (value === null || value === undefined) return { ok: true, value: null };
    return typeof value === "string" && isIsoDate(value)
      ? { ok: true, value }
      : { ok: false, error: `${name} must be a YYYY-MM-DD date` };
  };
}

function oneOf(name: string, values: readonly string[]): Field {
  return (value) =>
    typeof value === "string" && values.includes(value)
      ? { ok: true, value }
      : { ok: false, error: `${name} must be one of ${values.join(", ")}` };
}

function optionalNumber(name: string): Field {
  return (value) => {
    if (value === null || value === undefined) return { ok: true, value: null };
    return typeof value === "number" && Number.isFinite(value)
      ? { ok: true, value }
      : { ok: false, error: `${name} must be a number` };
  };
}

function optionalInt(name: string, min: number, max: number): Field {
  return (value) => {
    if (value === null || value === undefined) return { ok: true, value: null };
    return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
      ? { ok: true, value }
      : { ok: false, error: `${name} must be a whole number from ${min} to ${max}` };
  };
}

const bool: (name: string) => Field = (name) => (value) =>
  typeof value === "boolean" ? { ok: true, value } : { ok: false, error: `${name} must be true or false` };

const quarter: Field = (value) =>
  typeof value === "string" && QUARTER_RE.test(value)
    ? { ok: true, value }
    : { ok: false, error: "quarter must look like 2026-Q4" };

type Spec = {
  fields: Record<string, Field>;
  /** Required on create. */
  required: string[];
  /** Filled in on create when the caller leaves them out. */
  defaults: (ctx: { quarter: string }) => Row;
};

const SPECS: Record<L10ItemKind, Spec> = {
  rocks: {
    fields: {
      title,
      description: optionalText("description", TEXT_MAX),
      owner_user_id: optionalUuid("owner_user_id"),
      status: oneOf("status", ROCK_STATUSES),
      due_on: optionalDate("due_on"),
      quarter,
    },
    required: ["title"],
    defaults: (ctx) => ({ status: "on_track", quarter: ctx.quarter }),
  },
  measurables: {
    fields: {
      title,
      owner_id: optionalUuid("owner_id"),
      unit: oneOf("unit", L10_MEASURABLE_UNITS),
      goal_value: optionalNumber("goal_value"),
      goal_direction: oneOf("goal_direction", L10_GOAL_DIRECTIONS),
      sort_order: optionalInt("sort_order", 0, 10000),
      is_active: bool("is_active"),
    },
    required: ["title"],
    defaults: () => ({ unit: "number", goal_direction: "at_least", is_active: true }),
  },
  measurable_values: {
    fields: {
      measurable_id: requiredUuid("measurable_id"),
      week_start: monday,
      value: optionalNumber("value"),
      note: optionalText("note", TEXT_MAX),
    },
    required: ["measurable_id", "week_start"],
    defaults: () => ({}),
  },
  todos: {
    fields: {
      title,
      owner_id: optionalUuid("owner_id"),
      due_on: optionalDate("due_on"),
      done: bool("done"),
      source_meeting_id: optionalUuid("source_meeting_id"),
    },
    required: ["title"],
    defaults: () => ({ done: false }),
  },
  issues: {
    fields: {
      title,
      description: optionalText("description", TEXT_MAX),
      owner_id: optionalUuid("owner_id"),
      priority: optionalInt("priority", 1, 3),
      status: oneOf("status", L10_ISSUE_STATUSES),
      source_meeting_id: optionalUuid("source_meeting_id"),
      resolved_meeting_id: optionalUuid("resolved_meeting_id"),
    },
    required: ["title"],
    defaults: () => ({ status: "identified" }),
  },
  headlines: {
    fields: {
      body: requiredText("body", HEADLINE_MAX),
      author_id: optionalUuid("author_id"),
      source_meeting_id: optionalUuid("source_meeting_id"),
    },
    required: ["body"],
    defaults: () => ({}),
  },
};

/** Columns a caller may not set on a patch: where an item came from, and which week a value is for. */
const CREATE_ONLY = new Set(["source_meeting_id", "measurable_id", "week_start"]);

function parseFields(kind: L10ItemKind, body: unknown, mode: "create" | "patch"): Parsed<Row> {
  if (!isRecord(body)) return { ok: false, error: "Body must be a JSON object" };
  const spec = SPECS[kind];
  const out: Row = {};
  for (const key of Object.keys(body)) {
    if (!(key in spec.fields) || (mode === "patch" && CREATE_ONLY.has(key))) {
      return { ok: false, error: `Unknown field: ${key}` };
    }
    const parsed = spec.fields[key](body[key]);
    if (!parsed.ok) return parsed;
    out[key] = parsed.value;
  }
  if (mode === "create") {
    for (const key of spec.required) if (!(key in out)) return { ok: false, error: `${key} is required` };
  } else if (Object.keys(out).length === 0) {
    return { ok: false, error: "Nothing to change" };
  }
  return { ok: true, value: out };
}

export function parseItemCreate(kind: L10ItemKind, body: unknown, ctx: { quarter: string }): Parsed<Row> {
  const parsed = parseFields(kind, body, "create");
  if (!parsed.ok) return parsed;
  return { ok: true, value: { ...SPECS[kind].defaults(ctx), ...parsed.value } };
}

export function parseItemPatch(kind: L10ItemKind, body: unknown): Parsed<Row> {
  return parseFields(kind, body, "patch");
}

// ── Meetings ───────────────────────────────────────────────

export type MeetingStart = { attendee_user_ids: string[] | null; facilitator_id: string | null };

export function parseMeetingStart(body: unknown): Parsed<MeetingStart> {
  const none: MeetingStart = { attendee_user_ids: null, facilitator_id: null };
  if (body === null || body === undefined) return { ok: true, value: none };
  if (!isRecord(body)) return { ok: false, error: "Body must be a JSON object" };
  for (const key of Object.keys(body)) {
    if (key !== "attendee_user_ids" && key !== "facilitator_id") return { ok: false, error: `Unknown field: ${key}` };
  }
  const facilitator = optionalUuid("facilitator_id")(body.facilitator_id);
  if (!facilitator.ok) return facilitator;
  const ids = body.attendee_user_ids;
  if (ids === undefined || ids === null) return { ok: true, value: { ...none, facilitator_id: facilitator.value as string | null } };
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every(isUuid)) {
    return { ok: false, error: "attendee_user_ids must be a non-empty list of user ids" };
  }
  return { ok: true, value: { attendee_user_ids: [...new Set(ids as string[])], facilitator_id: facilitator.value as string | null } };
}

export type SegmentAdvance = { from: L10Segment | null };

export function parseSegmentAdvance(body: unknown): Parsed<SegmentAdvance> {
  if (body === null || body === undefined) return { ok: true, value: { from: null } };
  if (!isRecord(body)) return { ok: false, error: "Body must be a JSON object" };
  for (const key of Object.keys(body)) if (key !== "from") return { ok: false, error: `Unknown field: ${key}` };
  if (body.from === undefined || body.from === null) return { ok: true, value: { from: null } };
  const from = oneOf("from", L10_SEGMENTS)(body.from);
  if (!from.ok) return from;
  return { ok: true, value: { from: from.value as L10Segment } };
}

export type MeetingEnd = { ratings: { user_id: string; rating: number }[] };

export function parseMeetingEnd(body: unknown): Parsed<MeetingEnd> {
  if (body === null || body === undefined) return { ok: true, value: { ratings: [] } };
  if (!isRecord(body)) return { ok: false, error: "Body must be a JSON object" };
  for (const key of Object.keys(body)) if (key !== "ratings") return { ok: false, error: `Unknown field: ${key}` };
  const raw = body.ratings ?? [];
  if (!Array.isArray(raw)) return { ok: false, error: "ratings must be a list" };
  const seen = new Set<string>();
  const ratings: MeetingEnd["ratings"] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || !isUuid(entry.user_id)) return { ok: false, error: "Each rating needs a user_id" };
    const r = entry.rating;
    if (typeof r !== "number" || !Number.isInteger(r) || r < L10_RATING_MIN || r > L10_RATING_MAX) {
      return { ok: false, error: `rating must be a whole number from ${L10_RATING_MIN} to ${L10_RATING_MAX}` };
    }
    if (seen.has(entry.user_id)) return { ok: false, error: "Each attendee can be rated once" };
    seen.add(entry.user_id);
    ratings.push({ user_id: entry.user_id, rating: r });
  }
  return { ok: true, value: { ratings } };
}
