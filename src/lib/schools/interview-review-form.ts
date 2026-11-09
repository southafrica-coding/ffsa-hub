import { isInterviewOutcome, type InterviewOutcome } from "@/lib/schools/interview-outcomes";

// The interview form on a school application. One row per author in
// application_staff_reviews. The screen has to show that row again when it
// is reopened, including when the row arrives after the first paint.

export type InterviewFormState = {
  notes: string;
  outcome: InterviewOutcome;
};

export type InterviewDraft = InterviewFormState & {
  applicationId: string | null;
  baselineNotes: string;
  baselineOutcome: InterviewOutcome;
};

const NOTE_KEYS = ["notes", "interview_notes", "note"] as const;
const OUTCOME_KEYS = ["interview_outcome", "outcome", "interviewOutcome"] as const;

function firstString(row: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    const value = row[key];
    if (typeof value === "string") return value;
    if (value == null) continue;
  }
  return null;
}

export function emptyInterviewForm(): InterviewFormState {
  return { notes: "", outcome: "pending" };
}

/** Saved review → the outcome select and the note box. Unknown shapes stay pending and blank. */
export function interviewFormFromReview(review: unknown): InterviewFormState {
  if (!review || typeof review !== "object") return emptyInterviewForm();
  const row = review as Record<string, unknown>;
  const notes = firstString(row, NOTE_KEYS) ?? "";
  const outcomeRaw = firstString(row, OUTCOME_KEYS);
  return {
    notes,
    outcome: isInterviewOutcome(outcomeRaw) ? outcomeRaw : "pending",
  };
}

export function draftFromSaved(saved: InterviewFormState, applicationId: string | null): InterviewDraft {
  return {
    applicationId,
    notes: saved.notes,
    outcome: saved.outcome,
    baselineNotes: saved.notes,
    baselineOutcome: saved.outcome,
  };
}

export function emptyInterviewDraft(applicationId: string | null = null): InterviewDraft {
  return draftFromSaved(emptyInterviewForm(), applicationId);
}

export type InterviewReviewRow = {
  mine?: boolean;
  author_id?: string | null;
  application_response_id?: string | null;
  notes?: string | null;
  note?: string | null;
  interview_notes?: string | null;
  interview_outcome?: string | null;
  outcome?: string | null;
  interviewOutcome?: string | null;
};

/** The viewer's own row. `mine` is the API flag; `author_id` covers server-rendered rows. */
export function ownInterviewReview<T extends InterviewReviewRow>(
  rows: T[],
  viewerId?: string | null
): T | undefined {
  const flagged = rows.find((row) => row.mine === true);
  if (flagged) return flagged;
  if (!viewerId) return undefined;
  return rows.find((row) => row.author_id === viewerId);
}

export function savedInterviewFor(
  reviews: InterviewReviewRow[],
  applicationId: string,
  viewerId?: string | null
): InterviewFormState {
  const forApplication = reviews.filter(
    (row) => !row.application_response_id || row.application_response_id === applicationId
  );
  return interviewFormFromReview(ownInterviewReview(forApplication, viewerId));
}

function isDirty(draft: InterviewDraft): boolean {
  return draft.notes !== draft.baselineNotes || draft.outcome !== draft.baselineOutcome;
}

/**
 * Copy a saved row into a draft that is still the empty default, or that
 * belongs to another application. Leave a draft the reviewer has edited.
 */
export function reconcileInterviewDraft(
  draft: InterviewDraft,
  saved: InterviewFormState,
  applicationId: string | null
): InterviewDraft {
  if (draft.applicationId !== applicationId) return draftFromSaved(saved, applicationId);
  if (isDirty(draft)) return draft;
  if (
    draft.notes === saved.notes &&
    draft.outcome === saved.outcome &&
    draft.baselineNotes === saved.notes &&
    draft.baselineOutcome === saved.outcome
  ) {
    return draft;
  }
  return draftFromSaved(saved, applicationId);
}

/**
 * Apply a loaded list of reviews. An identifiable own row prefills the form.
 * Anything else leaves the draft as it is. Wiping it back to "no decision yet"
 * because the list was empty, or because a row could not be attributed, is
 * what let a later save blank a stored outcome.
 */
export function nextDraftAfterLoad(
  draft: InterviewDraft,
  rows: InterviewReviewRow[],
  viewerId?: string | null
): InterviewDraft {
  const own = ownInterviewReview(rows, viewerId);
  if (!own) return draft;
  return reconcileInterviewDraft(draft, interviewFormFromReview(own), draft.applicationId);
}

/** Flags the save sends. Both stay false for an untouched or not-yet-loaded form. */
export function interviewClearFlags(draft: InterviewDraft): {
  clear_outcome: boolean;
  clear_notes: boolean;
} {
  return {
    clear_outcome: draft.outcome === "pending" && draft.baselineOutcome !== "pending",
    clear_notes: draft.notes.trim() === "" && draft.baselineNotes.trim() !== "",
  };
}

export type InterviewWrite = {
  notes: string | null;
  outcome: InterviewOutcome;
};

/**
 * A re-save of the empty default (pending + no note) must not replace a
 * stored outcome or note. Clearing either one requires the matching flag,
 * which the form sends only after the reviewer changes that control.
 */
export function preserveInterviewWrite(input: {
  existing: { notes?: string | null; interview_outcome?: string | null } | null;
  notes: string;
  outcome: InterviewOutcome;
  clearOutcome: boolean;
  clearNotes: boolean;
}): InterviewWrite {
  if (!input.existing) {
    return { notes: input.notes || null, outcome: input.outcome };
  }
  const existingOutcome = isInterviewOutcome(input.existing.interview_outcome)
    ? input.existing.interview_outcome
    : "pending";
  const outcome =
    input.outcome === "pending" && existingOutcome !== "pending" && input.clearOutcome !== true
      ? existingOutcome
      : input.outcome;
  const existingNotes = typeof input.existing.notes === "string" ? input.existing.notes.trim() : "";
  const notes =
    !input.notes && existingNotes && input.clearNotes !== true ? existingNotes : input.notes || null;
  return { notes, outcome };
}
