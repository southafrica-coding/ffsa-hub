// FFSA Hub — How many references a school asks for, as one number.
//
// Every FFSA school asks for two, and shipped behaviour depends on it: the
// apply form won't submit without the program's required references, the
// confirmation email says the review waits for "both of your references", and
// the status tracker counts them in.
//
// The floor is enforced at CONFIGURATION time only — a program can't be taken
// below this many required reference slots
// (src/app/api/schools/applications/reference-slots), and the form builder
// names the shortfall. Submission is not gated on it: the apply endpoints
// enforce whatever required slots a program actually has, which for every real
// school is two.
//
// It is a FLOOR, not a fixed count: a school wanting a third reference just
// adds one, and every check is a `<` comparison.

export const MIN_REQUIRED_REFERENCE_SLOTS = 2;

export function countRequiredSlots(
  slots: Array<{ is_required: boolean }> | null | undefined
): number {
  return (slots ?? []).filter((s) => s.is_required).length;
}
