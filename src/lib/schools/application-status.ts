import {
  isStoredApplicationStatus,
  type StoredApplicationStatus,
} from "./applicant-pipeline-stage";

/** One request may move this many applications. Above this, the route returns 400. */
export const BULK_STATUS_LIMIT = 100;

/**
 * Stages that sit before a person is accepted. Moving an accepted
 * applicant here leaves their enrolment in place, so it is not silent.
 */
const BEFORE_ACCEPTANCE = new Set<StoredApplicationStatus>([
  "submitted",
  "waiting_for_references",
  "references_received",
  "interview_scheduled",
]);

export function isBeforeAcceptance(status: string): boolean {
  return BEFORE_ACCEPTANCE.has(status as StoredApplicationStatus);
}

export function acceptedRegressNeedsConfirm(
  previous: string | null | undefined,
  next: string,
  confirm: boolean
): boolean {
  return previous === "accepted" && isBeforeAcceptance(next) && confirm !== true;
}

export function storedStatusError(status: unknown): string | null {
  if (typeof status === "string" && isStoredApplicationStatus(status)) return null;
  return "That status is not one this form can save.";
}
