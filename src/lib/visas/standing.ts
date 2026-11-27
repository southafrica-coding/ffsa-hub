// FFSA's standing documents (migration 500): when each one runs out, and
// checking what legal types in. A certified copy runs out renew_months
// after it was certified; a document with its own expiry runs out then;
// whichever comes first counts.

import { addMonths, type IsoDate } from "./stay";
import { daysUntil } from "./display";
import { isIsoDate } from "./api";

export interface StandingDocument {
  id: string;
  label: string;
  description: string | null;
  certified_on: string | null;
  renew_months: number | null;
  expires_on: string | null;
  for_students: boolean;
  sort_order: number;
  is_active: boolean;
  storage_path: string | null;
  mime_type: string | null;
  file_uploaded_at: string | null;
}

/** Warn this many days before a document runs out. */
export const STANDING_SOON_DAYS = 30;

export type StandingState = "no_file" | "expired" | "soon" | "ok";

/** The day the document stops being valid, or null if it doesn't run out. */
export function standingDueOn(d: Pick<StandingDocument, "certified_on" | "renew_months" | "expires_on">): IsoDate | null {
  const recert = d.certified_on && d.renew_months ? addMonths(d.certified_on, d.renew_months) : null;
  if (recert && d.expires_on) return recert < d.expires_on ? recert : d.expires_on;
  return recert ?? d.expires_on ?? null;
}

export function standingState(
  d: Pick<StandingDocument, "certified_on" | "renew_months" | "expires_on" | "storage_path">,
  today?: string
): StandingState {
  if (!d.storage_path) return "no_file";
  const due = standingDueOn(d);
  if (!due) return "ok";
  const left = daysUntil(due, today);
  if (left <= 0) return "expired";
  return left <= STANDING_SOON_DAYS ? "soon" : "ok";
}

/** Active documents that need legal: no file, run out, or running out. */
export function standingNeedingAttention<T extends StandingDocument>(docs: T[], today?: string): T[] {
  return docs.filter((d) => d.is_active && standingState(d, today) !== "ok");
}

export interface StandingInput {
  label: string;
  description: string | null;
  certified_on: string | null;
  renew_months: number | null;
  expires_on: string | null;
  for_students: boolean;
  sort_order: number;
  is_active: boolean;
}

/** What legal sent, checked; or the first problem in words. */
export function cleanStandingDocument(body: unknown): { data: StandingInput } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const label = typeof b.label === "string" ? b.label.trim() : "";
  if (!label || label.length > 200) return { error: "Give the document a name (up to 200 characters)" };
  const description = typeof b.description === "string" ? b.description.trim() || null : null;
  if (description && description.length > 2000) return { error: "The description is too long" };
  const date = (v: unknown, what: string): string | null | { error: string } => {
    if (v == null || v === "") return null;
    return isIsoDate(v) ? v : { error: `${what} must be a date` };
  };
  const certified = date(b.certified_on, "The certification date");
  if (typeof certified === "object" && certified) return certified;
  const expires = date(b.expires_on, "The expiry date");
  if (typeof expires === "object" && expires) return expires;
  let renew: number | null = null;
  if (b.renew_months != null && b.renew_months !== "") {
    const n = Number(b.renew_months);
    if (!Number.isInteger(n) || n < 1 || n > 60) return { error: "Re-certify every 1 to 60 months" };
    renew = n;
  }
  if (renew && !certified) return { error: "Give the date it was certified, so the Hub knows when to re-certify" };
  const sort = b.sort_order == null || b.sort_order === "" ? 0 : Number(b.sort_order);
  if (!Number.isInteger(sort) || Math.abs(sort) > 10000) return { error: "Order must be a whole number" };
  if (typeof (b.for_students ?? false) !== "boolean" || typeof (b.is_active ?? true) !== "boolean") {
    return { error: "for_students and is_active must be true or false" };
  }
  return {
    data: {
      label,
      description,
      certified_on: certified as string | null,
      renew_months: renew,
      expires_on: expires as string | null,
      for_students: (b.for_students as boolean | undefined) ?? false,
      sort_order: sort,
      is_active: (b.is_active as boolean | undefined) ?? true,
    },
  };
}
