// FFSA Hub — How many references a school asks for, as one number.
//
// Every FFSA school asks for two, and three shipped behaviours depend on it:
// the apply form won't submit without them, the confirmation email says the
// review waits for "both of your references", and the status tracker counts
// them in. The rule is enforced in two places that must agree —
//
//   - configuration: a program can't be taken below this many required
//     reference slots (src/app/api/schools/applications/reference-slots)
//   - submission: an application can't be accepted against a program that has
//     fewer than this many (both apply endpoints)
//
// — so the number lives here rather than being written down twice.
//
// It is a FLOOR, not a fixed count: a school wanting a third reference just
// adds one, and every check below is a `<` comparison.

export const MIN_REQUIRED_REFERENCE_SLOTS = 2;

/**
 * Whether a program is configured to take applications at all, reference-wise.
 *
 * A program short of the floor is a staff configuration mistake, not an
 * applicant mistake — callers should keep the apply form off the page rather
 * than let someone fill it in and be rejected at the end.
 */
export function hasEnoughReferenceSlots(
  slots: Array<{ is_required: boolean }> | null | undefined
): boolean {
  return countRequiredSlots(slots) >= MIN_REQUIRED_REFERENCE_SLOTS;
}

export function countRequiredSlots(
  slots: Array<{ is_required: boolean }> | null | undefined
): number {
  return (slots ?? []).filter((s) => s.is_required).length;
}
