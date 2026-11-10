import { ROCK_STATUSES, type RockStatus } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 4000;
const NOTES_MAX = 2000;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isIsoDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export type RockWrite = {
  title: string;
  description: string | null;
  owner_user_id: string | null;
  status: RockStatus;
  due_on: string | null;
  quarter: string;
};

export type RockPatch = Partial<RockWrite>;

export type BudgetPatch = {
  budget_cents?: number;
  notes?: string | null;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseTitle(value: unknown): Parsed<string> {
  if (typeof value !== "string" || value.trim() === "") return { ok: false, error: "Title is required" };
  const title = value.trim();
  if (title.length > TITLE_MAX) return { ok: false, error: `Title must be ${TITLE_MAX} characters or fewer` };
  return { ok: true, value: title };
}

function parseOptionalText(
  value: unknown,
  label: string,
  max: number
): Parsed<string | null> {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: `${label} must be text` };
  const text = value.trim();
  if (text.length > max) return { ok: false, error: `${label} must be ${max} characters or fewer` };
  return { ok: true, value: text === "" ? null : text };
}

function parseStatus(value: unknown, fallback: RockStatus | undefined): Parsed<RockStatus> {
  if (value == null) {
    if (fallback) return { ok: true, value: fallback };
    return { ok: false, error: "Status is required" };
  }
  if (typeof value !== "string" || !ROCK_STATUSES.includes(value as RockStatus)) {
    return { ok: false, error: "Status must be on_track, off_track or done" };
  }
  return { ok: true, value: value as RockStatus };
}

function parseOwner(value: unknown): Parsed<string | null> {
  if (value == null || value === "") return { ok: true, value: null };
  if (!isUuid(value)) return { ok: false, error: "owner_user_id must be a person id" };
  return { ok: true, value };
}

function parseDue(value: unknown): Parsed<string | null> {
  if (value == null || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || !isIsoDate(value)) {
    return { ok: false, error: "due_on must be a date like 2026-11-10" };
  }
  return { ok: true, value };
}

function parseQuarterField(value: unknown, fallback: string | undefined): Parsed<string> {
  if (value == null || value === "") {
    if (fallback) return { ok: true, value: fallback };
    return { ok: false, error: "Quarter must look like 2026-Q4" };
  }
  if (typeof value !== "string" || !/^(\d{4})-Q([1-4])$/.test(value)) {
    return { ok: false, error: "Quarter must look like 2026-Q4" };
  }
  return { ok: true, value };
}

export function parseRockCreate(body: unknown, quarter: string): Parsed<RockWrite> {
  if (!isRecord(body)) return { ok: false, error: "Invalid JSON body" };
  const title = parseTitle(body.title);
  if (!title.ok) return title;
  const description = parseOptionalText(body.description, "Description", DESCRIPTION_MAX);
  if (!description.ok) return description;
  const owner = parseOwner(body.owner_user_id);
  if (!owner.ok) return owner;
  const status = parseStatus(body.status, "on_track");
  if (!status.ok) return status;
  const due = parseDue(body.due_on);
  if (!due.ok) return due;
  const parsedQuarter = parseQuarterField(body.quarter, quarter);
  if (!parsedQuarter.ok) return parsedQuarter;
  return {
    ok: true,
    value: {
      title: title.value,
      description: description.value,
      owner_user_id: owner.value,
      status: status.value,
      due_on: due.value,
      quarter: parsedQuarter.value,
    },
  };
}

export function parseRockPatch(body: unknown): Parsed<RockPatch> {
  if (!isRecord(body)) return { ok: false, error: "Invalid JSON body" };
  const patch: RockPatch = {};
  if ("title" in body) {
    const title = parseTitle(body.title);
    if (!title.ok) return title;
    patch.title = title.value;
  }
  if ("description" in body) {
    const description = parseOptionalText(body.description, "Description", DESCRIPTION_MAX);
    if (!description.ok) return description;
    patch.description = description.value;
  }
  if ("owner_user_id" in body) {
    const owner = parseOwner(body.owner_user_id);
    if (!owner.ok) return owner;
    patch.owner_user_id = owner.value;
  }
  if ("status" in body) {
    const status = parseStatus(body.status, undefined);
    if (!status.ok) return status;
    patch.status = status.value;
  }
  if ("due_on" in body) {
    const due = parseDue(body.due_on);
    if (!due.ok) return due;
    patch.due_on = due.value;
  }
  if ("quarter" in body) {
    const quarter = parseQuarterField(body.quarter, undefined);
    if (!quarter.ok) return quarter;
    patch.quarter = quarter.value;
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "Nothing to change" };
  }
  return { ok: true, value: patch };
}

export function parseBudgetPatch(
  body: unknown
): Parsed<{ linkId: string; patch: BudgetPatch }> {
  if (!isRecord(body)) return { ok: false, error: "Invalid JSON body" };
  if ("spend_cents" in body) {
    return { ok: false, error: "Spend is recorded from finance and can't be edited here" };
  }
  if (!isUuid(body.link_id)) return { ok: false, error: "link_id must be the budget link id" };
  const patch: BudgetPatch = {};
  if ("budget_cents" in body) {
    const amount = body.budget_cents;
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER) {
      return { ok: false, error: "budget_cents must be a whole number of cents, zero or more" };
    }
    patch.budget_cents = amount;
  }
  if ("notes" in body) {
    const notes = parseOptionalText(body.notes, "Notes", NOTES_MAX);
    if (!notes.ok) return notes;
    patch.notes = notes.value;
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "Nothing to change: send budget_cents or notes" };
  }
  return { ok: true, value: { linkId: body.link_id, patch } };
}
