// Which pipeline tab an application sits on.
//
// application_responses.status is what staff stored, and what the
// applicant-facing status page still reads. Two of the tabs are answered
// by other rows, so the pipeline does not trust that column for them:
//
// - References received: every reference slot with is_required has a
//   reference_requests row whose status is 'submitted'. One submitted row
//   satisfies its slot; a second pending row for the same slot (an edit
//   that has not landed, or a replaced referee) does not keep the
//   application waiting. Optional slots do not count. A status other than
//   'submitted' does not count. This only promotes the early stored
//   statuses, submitted and waiting_for_references. interview_scheduled
//   and the decision statuses stay where staff put them.
//
// - Submitted also absorbs a stored waiting_for_references while a required
//   reference is still outstanding. The enum value stays. The applicant
//   status page still reads it. There is no Waiting for refs tab.
//
// - Interview complete: at least one application_staff_reviews row has
//   interview_outcome recommend, hold, or decline. Notes on their own do
//   not count. Outcome 'pending' is "no decision yet", and a note can be
//   written before the interview is finished. Saving a review does not
//   change application_responses.status (migration 306); this tab is
//   derived. A stored decision (accepted, rejected, waitlisted, cancelled)
//   is left on that tab. When several reviews have decided, the badge is
//   the most recently updated decisive outcome.
//
// The stages are the same for every school. Nothing in program config
// renames or reorders them. What varies is which slots are required.

export const PIPELINE_STAGE_ORDER = [
  "submitted",
  "references_received",
  "interview_scheduled",
  "interview_complete",
  "accepted",
  "waitlisted",
  "rejected",
  "cancelled",
] as const;

export type PipelineStageKey = (typeof PIPELINE_STAGE_ORDER)[number];

export const PIPELINE_STAGE_LABEL: Record<PipelineStageKey, string> = {
  submitted: "Submitted",
  references_received: "References received",
  interview_scheduled: "Interview scheduled",
  interview_complete: "Interview complete",
  accepted: "Accepted",
  waitlisted: "Waitlisted",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/** Filter chips, in the order the applicants tab renders them. */
export const PIPELINE_TABS: Array<{ key: PipelineStageKey | "all" | "unassigned"; label: string }> = [
  { key: "all", label: "All" },
  ...PIPELINE_STAGE_ORDER.map((key) => ({ key, label: PIPELINE_STAGE_LABEL[key] })),
  { key: "unassigned", label: "Unassigned" },
];

export const DECISIVE_INTERVIEW_OUTCOMES = ["recommend", "hold", "decline"] as const;
export type DecisiveInterviewOutcome = (typeof DECISIVE_INTERVIEW_OUTCOMES)[number];

const TERMINAL_STATUSES = new Set(["accepted", "rejected", "waitlisted", "cancelled"]);
const EARLY_STATUSES = new Set(["submitted", "waiting_for_references"]);

export type ReferenceRequestFact = {
  slotId: string;
  status: string;
};

export type InterviewReviewFact = {
  interviewOutcome: string | null;
  updatedAt?: string | null;
};

export function isDecisiveInterviewOutcome(
  value: string | null | undefined
): value is DecisiveInterviewOutcome {
  return (
    value === "recommend" || value === "hold" || value === "decline"
  );
}

/**
 * True when every required slot has at least one request with status
 * 'submitted'. No required slots means there is nothing to complete, so
 * this is false and an application is not promoted.
 */
export function requiredReferencesComplete(
  requiredSlotIds: readonly string[],
  requests: readonly ReferenceRequestFact[]
): boolean {
  if (requiredSlotIds.length === 0) return false;
  const submittedSlots = new Set(
    requests.filter((request) => request.status === "submitted").map((request) => request.slotId)
  );
  return requiredSlotIds.every((slotId) => submittedSlots.has(slotId));
}

/**
 * Progress the applicant status page shows. Counts required slots only:
 * an optional request does not add to the total, and a required slot with
 * no request row stays outstanding. `complete` is requiredReferencesComplete.
 */
export function requiredReferenceProgress(
  slots: readonly { id: string; is_required: boolean }[],
  requests: readonly ReferenceRequestFact[]
): { required: number; received: number; complete: boolean } {
  const requiredSlotIds = slots.filter((slot) => slot.is_required).map((slot) => slot.id);
  const received = requiredSlotIds.filter((slotId) =>
    requests.some((request) => request.slotId === slotId && request.status === "submitted")
  ).length;
  return {
    required: requiredSlotIds.length,
    received,
    complete: requiredReferencesComplete(requiredSlotIds, requests),
  };
}

export function interviewIsComplete(reviews: readonly InterviewReviewFact[]): boolean {
  return reviews.some((review) => isDecisiveInterviewOutcome(review.interviewOutcome));
}

/** Latest decisive outcome, or null when nobody has chosen one. */
export function interviewOutcomeBadge(
  reviews: readonly InterviewReviewFact[]
): DecisiveInterviewOutcome | null {
  const decisive = reviews
    .filter((review) => isDecisiveInterviewOutcome(review.interviewOutcome))
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const outcome = decisive[0]?.interviewOutcome;
  return isDecisiveInterviewOutcome(outcome) ? outcome : null;
}

export function derivePipelineStage(input: {
  storedStatus: string;
  requiredSlotIds: readonly string[];
  requests: readonly ReferenceRequestFact[];
  reviews: readonly InterviewReviewFact[];
}): PipelineStageKey | string {
  if (TERMINAL_STATUSES.has(input.storedStatus)) return input.storedStatus;
  if (interviewIsComplete(input.reviews)) return "interview_complete";
  if (input.storedStatus === "interview_scheduled") return "interview_scheduled";
  if (
    EARLY_STATUSES.has(input.storedStatus) &&
    requiredReferencesComplete(input.requiredSlotIds, input.requests)
  ) {
    return "references_received";
  }
  if (input.storedStatus === "waiting_for_references") return "submitted";
  return input.storedStatus;
}

/**
 * Stored status to write after a reference is submitted.
 * Null means leave the row alone: a later stage, or the required
 * references are not all in yet.
 */
export function statusAfterReferencesComplete(input: {
  storedStatus: string;
  requiredSlotIds: readonly string[];
  requests: readonly ReferenceRequestFact[];
}): "references_received" | null {
  if (!EARLY_STATUSES.has(input.storedStatus)) return null;
  if (!requiredReferencesComplete(input.requiredSlotIds, input.requests)) return null;
  return "references_received";
}
