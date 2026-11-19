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
  is_active: boolean;
  sort_order: number;
}

export interface ChecklistDocument {
  id: string;
  document_type_id: string;
  status: "uploaded" | "approved" | "needs_redo" | "ticked";
  review_note: string | null;
  issued_on: string | null;
  storage_path: string | null;
  created_at: string;
}

export type ItemState = "missing" | "uploaded" | "approved" | "needs_redo" | "ticked";

export interface ChecklistItem<T extends ChecklistType = ChecklistType> {
  type: T;
  /** The newest upload or tick for this type; it's the one that counts. */
  latest: ChecklistDocument | null;
  state: ItemState;
  /** Holds up "Request approval" until it's approved or ticked. */
  blocking: boolean;
}

export const ITEM_LABEL: Record<ItemState, string> = {
  missing: "Not in yet",
  uploaded: "Waiting for review",
  approved: "Approved",
  needs_redo: "Needs a redo",
  ticked: "Done",
};

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
 */
export function buildChecklist<T extends ChecklistType>(
  types: T[],
  docs: ChecklistDocument[],
  stayDays: number | null
): ChecklistItem<T>[] {
  const long = stayDays != null && stayDays > SHORT_STAY_MAX_DAYS;
  const latest = latestByType(docs);
  return types
    .filter((t) => t.is_active && (long ? t.needed_over_90 : t.needed_up_to_90))
    .sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code))
    .map((type) => {
      const doc = latest.get(type.id) ?? null;
      const state: ItemState = doc ? doc.status : "missing";
      const done = state === "approved" || state === "ticked";
      return { type, latest: doc, state, blocking: !type.is_conditional && !done };
    });
}

/** Required items still missing or waiting on a redo: the student's to-do. */
export function studentToDo(items: ChecklistItem[]): ChecklistItem[] {
  return items.filter((i) => !i.type.is_conditional && (i.state === "missing" || i.state === "needs_redo"));
}

/** Uploads waiting for a leader's review. */
export function toReview(items: ChecklistItem[]): ChecklistItem[] {
  return items.filter((i) => i.state === "uploaded");
}
