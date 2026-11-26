// The document checklist a screen shows for a case. Mirrors
// visa_missing_documents / visa_refresh_waiting_on in migration 363, so the
// page and the database agree on what's missing. Pure; no I/O.

import { SHORT_STAY_MAX_DAYS } from "./stay";

export interface ChecklistType {
  id: string;
  code: string;
  label: string;
  guidance: string | null;
  needed_up_to_90: boolean;
  needed_over_90: boolean;
  is_conditional: boolean;
  is_offline: boolean;
  /** Police clearance, medical report: only global legal and the student see these. */
  is_restricted: boolean;
  /** The objective checks a school leader goes through for this document. */
  leader_checks: string[];
  is_active: boolean;
  sort_order: number;
}

export interface ChecklistDocument {
  id: string;
  document_type_id: string;
  status: "uploaded" | "checked" | "flagged" | "approved" | "needs_redo" | "ticked";
  review_note: string | null;
  issued_on: string | null;
  storage_path: string | null;
  created_at: string;
}

/**
 * with_legal: a restricted document this viewer can't see (a school
 * leader), which is in and with legal.
 */
export type ItemState = "missing" | "uploaded" | "checked" | "flagged" | "approved" | "needs_redo" | "ticked" | "with_legal";

export interface ChecklistItem<T extends ChecklistType = ChecklistType> {
  type: T;
  /** The newest upload or tick for this type; it's the one that counts. */
  latest: ChecklistDocument | null;
  state: ItemState;
  /** Holds up "Request approval" until it's checked, approved or ticked. */
  blocking: boolean;
}

export const ITEM_LABEL: Record<ItemState, string> = {
  missing: "Not in yet",
  uploaded: "Waiting for a check",
  checked: "Checked",
  flagged: "Needs fixing",
  approved: "Approved",
  needs_redo: "Needs a redo",
  ticked: "Done",
  with_legal: "In, with legal",
};

/** Ready for legal: what visa_missing_documents (363) counts as in. */
function isDone(type: ChecklistType, state: ItemState): boolean {
  return (
    state === "checked" ||
    state === "approved" ||
    state === "ticked" ||
    state === "with_legal" ||
    (type.is_restricted && state === "uploaded")
  );
}

/** Newest document per type (by created_at, then id, as the SQL does). */
export function latestByType(docs: ChecklistDocument[]): Map<string, ChecklistDocument> {
  const out = new Map<string, ChecklistDocument>();
  for (const d of docs) {
    const cur = out.get(d.document_type_id);
    if (!cur || d.created_at > cur.created_at || (d.created_at === cur.created_at && d.id > cur.id)) {
      out.set(d.document_type_id, d);
    }
  }
  return out;
}

/**
 * The checklist for a stay. stayDays null (dates not set) uses the short
 * list, as the database does. Conditional types are listed but never block.
 * missingCodes (from visa_case_missing_documents) lets a school leader,
 * who can't see restricted documents, see whether one is in.
 */
export function buildChecklist<T extends ChecklistType>(
  types: T[],
  docs: ChecklistDocument[],
  stayDays: number | null,
  missingCodes?: string[]
): ChecklistItem<T>[] {
  const long = stayDays != null && stayDays > SHORT_STAY_MAX_DAYS;
  const latest = latestByType(docs);
  return types
    .filter((t) => t.is_active && (long ? t.needed_over_90 : t.needed_up_to_90))
    .sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code))
    .map((type) => {
      const doc = latest.get(type.id) ?? null;
      let state: ItemState = doc ? doc.status : "missing";
      if (!doc && type.is_restricted && missingCodes && !missingCodes.includes(type.code)) state = "with_legal";
      return { type, latest: doc, state, blocking: !type.is_conditional && !isDone(type, state) };
    });
}

/** Required items still missing, flagged or waiting on a redo: the student's to-do. */
export function studentToDo(items: ChecklistItem[]): ChecklistItem[] {
  return items.filter(
    (i) => !i.type.is_conditional && (i.state === "missing" || i.state === "flagged" || i.state === "needs_redo")
  );
}

/**
 * Documents waiting on this reviewer. A school leader checks fresh uploads
 * (never restricted ones); legal judges anything not yet approved.
 */
export function toReview(items: ChecklistItem[], as: "leader" | "legal" = "leader"): ChecklistItem[] {
  if (as === "legal") return items.filter((i) => i.state === "uploaded" || i.state === "checked" || i.state === "flagged");
  return items.filter((i) => i.state === "uploaded" && !i.type.is_restricted);
}
