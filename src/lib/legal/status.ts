// Legal → Documents — expiry and application rules. Plan: docs/legal-documents.md
// ("Expiry rules"). Pure functions: every date is a YYYY-MM-DD string and
// "today" is passed in, so the screens, the reminder job and the tests agree.

export { todayInSA } from "@/lib/users/profile-fields";

/** Lead time when neither the document nor its type sets one. */
export const DEFAULT_LEAD_DAYS = 60;

export type DocumentState =
  | "expired" //   past its expiry date
  | "expiring" //  inside its renewal window, nothing under way
  | "in_hand" //   inside its renewal window, renewal under way
  | "valid" //     outside its renewal window
  | "no_expiry" // held, no expiry date
  | "missing" //   needed but not held
  | "inactive"; // superseded or cancelled: never flagged

export type DocumentStateInput = {
  status: string;
  expires_on: string | null;
  renew_lead_days: number | null;
  superseded_by?: string | null;
  /** The type's lead_days, when the document has a type. */
  type_lead_days?: number | null;
  /** true when an open application points at this document. */
  has_open_application?: boolean;
};

export type DocumentStateResult = {
  state: DocumentState;
  /** Whole days until expiry; negative once past. null without a date. */
  daysLeft: number | null;
  leadDays: number;
};

/** Whole calendar days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) throw new Error(`Bad date: ${from} / ${to}`);
  return Math.round((b - a) / 86_400_000);
}

export function leadDaysFor(doc: Pick<DocumentStateInput, "renew_lead_days" | "type_lead_days">): number {
  return doc.renew_lead_days ?? doc.type_lead_days ?? DEFAULT_LEAD_DAYS;
}

export function documentState(doc: DocumentStateInput, today: string): DocumentStateResult {
  const leadDays = leadDaysFor(doc);
  const daysLeft = doc.expires_on ? daysBetween(today, doc.expires_on) : null;

  if (doc.superseded_by || doc.status === "superseded" || doc.status === "cancelled") {
    return { state: "inactive", daysLeft, leadDays };
  }
  // Not held yet: "missing", unless an application for it is under way.
  if (doc.status === "not_held") {
    return { state: doc.has_open_application ? "in_hand" : "missing", daysLeft, leadDays };
  }
  if (daysLeft === null) {
    return { state: doc.status === "applying" ? "in_hand" : "no_expiry", daysLeft, leadDays };
  }
  // An expired document stays expired even with a renewal under way: it is
  // not valid today, and the screens must say so.
  if (daysLeft < 0) return { state: "expired", daysLeft, leadDays };
  if (daysLeft <= leadDays) {
    const underway = doc.has_open_application || doc.status === "applying";
    return { state: underway ? "in_hand" : "expiring", daysLeft, leadDays };
  }
  return { state: "valid", daysLeft, leadDays };
}

/** States that need someone to act. */
export const ATTENTION_STATES: DocumentState[] = ["expired", "expiring", "missing"];

// ────────────────────────────────────────────────────────────
// APPLICATIONS
// ────────────────────────────────────────────────────────────

export const CLOSED_APPLICATION_STATUSES = ["approved", "refused", "withdrawn"] as const;
const NOT_YET_LODGED = ["planned", "gathering"];

export type ApplicationState =
  | "late" //      lodge-by date passed, not lodged yet
  | "due_soon" //  lodge-by within 14 days, not lodged yet
  | "open" //      in progress, nothing pressing
  | "waiting" //   lodged, waiting on the other side
  | "overdue" //   lodged and past its expected date
  | "closed";

export const APPLICATION_DUE_SOON_DAYS = 14;

export function isApplicationOpen(status: string): boolean {
  return !(CLOSED_APPLICATION_STATUSES as readonly string[]).includes(status);
}

export function applicationState(
  app: { status: string; lodge_by: string | null; expected_on: string | null },
  today: string
): ApplicationState {
  if (!isApplicationOpen(app.status)) return "closed";
  if (NOT_YET_LODGED.includes(app.status)) {
    if (app.lodge_by) {
      const d = daysBetween(today, app.lodge_by);
      if (d < 0) return "late";
      if (d <= APPLICATION_DUE_SOON_DAYS) return "due_soon";
    }
    return "open";
  }
  if (app.expected_on && daysBetween(today, app.expected_on) < 0) return "overdue";
  return "waiting";
}

// ────────────────────────────────────────────────────────────
// WORDS — one place for the labels the screens and emails use
// ────────────────────────────────────────────────────────────

export function describeDays(daysLeft: number | null): string {
  if (daysLeft === null) return "No expiry date";
  if (daysLeft === 0) return "Expires today";
  if (daysLeft === 1) return "Expires tomorrow";
  if (daysLeft === -1) return "Expired yesterday";
  if (daysLeft < 0) return `Expired ${-daysLeft} days ago`;
  return `${daysLeft} days left`;
}

export const DOCUMENT_STATE_LABEL: Record<DocumentState, string> = {
  expired: "Expired",
  expiring: "Renew now",
  in_hand: "Renewal under way",
  valid: "Valid",
  no_expiry: "No expiry",
  missing: "Not held",
  inactive: "Replaced",
};

export const APPLICATION_STATE_LABEL: Record<ApplicationState, string> = {
  late: "Late to lodge",
  due_soon: "Lodge soon",
  open: "In progress",
  waiting: "Waiting",
  overdue: "Past expected date",
  closed: "Closed",
};
