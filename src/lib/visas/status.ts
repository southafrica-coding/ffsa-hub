// Visa case statuses and who each one waits on. Mirrors the CHECK
// constraints in supabase/migrations/360_visa_schema.sql; status.test.ts
// keeps the two in step.

export const VISA_STATUSES = [
  "collecting_documents",
  "awaiting_legal",
  "sent_back",
  "approved",
  "lodged",
  "granted",
  "refused",
  "exempt",
  "arrived",
  "closed",
  "withdrawn",
] as const;
export type VisaStatus = (typeof VISA_STATUSES)[number];

export const VISA_WAITING_ON = ["student", "school_leader", "legal", "embassy", "nobody"] as const;
export type VisaWaitingOn = (typeof VISA_WAITING_ON)[number];

/** Labels as the guide's "Case statuses" table words them. */
export const VISA_STATUS_LABEL: Record<VisaStatus, string> = {
  collecting_documents: "Collecting documents",
  awaiting_legal: "Waiting for legal",
  sent_back: "Sent back",
  approved: "Approved",
  lodged: "Lodged",
  granted: "Granted",
  refused: "Refused",
  exempt: "Visa-exempt",
  arrived: "Arrived",
  closed: "Closed",
  withdrawn: "Withdrawn",
};

/** Who a status normally waits on. Collecting documents is refined per case. */
export const VISA_STATUS_WAITING_ON: Record<VisaStatus, VisaWaitingOn> = {
  collecting_documents: "student",
  awaiting_legal: "legal",
  sent_back: "school_leader",
  approved: "student",
  lodged: "embassy",
  granted: "nobody",
  refused: "legal",
  exempt: "nobody",
  arrived: "nobody",
  closed: "nobody",
  withdrawn: "nobody",
};

export const VISA_OPEN_STATUSES: readonly VisaStatus[] = VISA_STATUSES.filter(
  (s) => s !== "closed" && s !== "withdrawn"
);

export function isVisaStatus(v: unknown): v is VisaStatus {
  return typeof v === "string" && (VISA_STATUSES as readonly string[]).includes(v);
}
