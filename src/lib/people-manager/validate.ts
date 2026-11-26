// Request bodies for the People Manager API. Plain checks, no library,
// like lib/l10/validate. Column limits follow migration 421.

import { isUuid } from "@/lib/departments/validate";
import { daysBetween, isIsoDate, LEAVE_MAX_RANGE_DAYS, partsFit } from "./days";
import { LEAVE_DAY_PARTS, type LeaveDayPart } from "./db.types";

type Ok<T> = { ok: true; value: T };
type Bad = { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function optionalText(v: unknown, max: number, field: string): Ok<string | null> | Bad {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: `${field} must be text` };
  const t = v.trim();
  if (t.length > max) return { ok: false, error: `${field} is longer than ${max} characters` };
  return { ok: true, value: t || null };
}

function part(v: unknown, field: string): Ok<LeaveDayPart> | Bad {
  if (v === undefined || v === null) return { ok: true, value: "full" };
  if (typeof v === "string" && (LEAVE_DAY_PARTS as readonly string[]).includes(v)) return { ok: true, value: v as LeaveDayPart };
  return { ok: false, error: `${field} must be full, am or pm` };
}

export type LeaveRange = { start_date: string; end_date: string; start_part: LeaveDayPart; end_part: LeaveDayPart };

export function parseRange(body: Record<string, unknown>): Ok<LeaveRange> | Bad {
  if (!isIsoDate(body.start_date)) return { ok: false, error: "start_date must be a YYYY-MM-DD date" };
  if (!isIsoDate(body.end_date)) return { ok: false, error: "end_date must be a YYYY-MM-DD date" };
  if (body.end_date < body.start_date) return { ok: false, error: "end_date is before start_date" };
  if (daysBetween(body.start_date, body.end_date) > LEAVE_MAX_RANGE_DAYS) return { ok: false, error: "The range is too long" };
  const sp = part(body.start_part, "start_part");
  if (!sp.ok) return sp;
  // A one-day request uses the same part on both ends; default end_part to start_part then.
  const ep = part(body.end_part ?? (body.start_date === body.end_date ? sp.value : undefined), "end_part");
  if (!ep.ok) return ep;
  if (!partsFit(body.start_date, body.end_date, sp.value, ep.value)) {
    return {
      ok: false,
      error: "A multi-day request may start full or pm and end full or am; a one-day request uses one part (full, am or pm)",
    };
  }
  return { ok: true, value: { start_date: body.start_date, end_date: body.end_date, start_part: sp.value, end_part: ep.value } };
}

export type LeaveRequestBody = LeaveRange & {
  leave_type_id: string;
  notes: string | null;
  covering_user_id: string | null;
  covering_note: string | null;
};

export function parseLeaveRequest(body: unknown, opts: { requireType?: boolean } = {}): Ok<LeaveRequestBody> | Bad {
  if (!isObject(body)) return { ok: false, error: "Body must be an object" };
  const requireType = opts.requireType ?? true;
  if (requireType && !isUuid(body.leave_type_id)) return { ok: false, error: "leave_type_id is required" };
  if (!requireType && body.leave_type_id !== undefined && body.leave_type_id !== null && !isUuid(body.leave_type_id)) {
    return { ok: false, error: "leave_type_id must be an id" };
  }
  const range = parseRange(body);
  if (!range.ok) return range;
  const notes = optionalText(body.notes, 2000, "notes");
  if (!notes.ok) return notes;
  const coveringNote = optionalText(body.covering_note, 500, "covering_note");
  if (!coveringNote.ok) return coveringNote;
  let covering: string | null = null;
  if (body.covering_user_id !== undefined && body.covering_user_id !== null) {
    if (!isUuid(body.covering_user_id)) return { ok: false, error: "covering_user_id must be an id" };
    covering = body.covering_user_id;
  }
  return {
    ok: true,
    value: {
      ...range.value,
      leave_type_id: typeof body.leave_type_id === "string" ? body.leave_type_id : "",
      notes: notes.value,
      covering_user_id: covering,
      covering_note: coveringNote.value,
    },
  };
}

export type DecisionBody = { decision: "approved" | "declined"; note: string | null };

/** { decision: "approved" | "declined", note? }. A decline needs a note (421). */
export function parseDecision(body: unknown): Ok<DecisionBody> | Bad {
  if (!isObject(body)) return { ok: false, error: "Body must be an object" };
  const decision = body.decision === "denied" ? "declined" : body.decision;
  if (decision !== "approved" && decision !== "declined") return { ok: false, error: "decision must be approved or declined" };
  const note = optionalText(body.note, 1000, "note");
  if (!note.ok) return note;
  if (decision === "declined" && !note.value) return { ok: false, error: "Say why when declining" };
  return { ok: true, value: { decision, note: note.value } };
}

export type BlockoutBody = { start_date: string; end_date: string; reason: string | null };

export function parseBlockout(body: unknown): Ok<BlockoutBody> | Bad {
  if (!isObject(body)) return { ok: false, error: "Body must be an object" };
  if (!isIsoDate(body.start_date)) return { ok: false, error: "start_date must be a YYYY-MM-DD date" };
  if (!isIsoDate(body.end_date)) return { ok: false, error: "end_date must be a YYYY-MM-DD date" };
  if (body.end_date < body.start_date) return { ok: false, error: "end_date is before start_date" };
  if (daysBetween(body.start_date, body.end_date) > 366) return { ok: false, error: "A block-out can be at most a year" };
  const reason = optionalText(body.reason, 500, "reason");
  if (!reason.ok) return reason;
  return { ok: true, value: { start_date: body.start_date, end_date: body.end_date, reason: reason.value } };
}

/** ?year=2026, defaulting to the given year. */
export function parseYear(raw: string | null, fallback: number): number | null {
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
}
