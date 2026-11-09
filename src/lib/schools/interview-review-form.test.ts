import { describe, expect, it } from "vitest";
import {
  draftFromSaved,
  emptyInterviewDraft,
  interviewClearFlags,
  interviewFormFromReview,
  nextDraftAfterLoad,
  ownInterviewReview,
  preserveInterviewWrite,
  reconcileInterviewDraft,
  savedInterviewFor,
} from "./interview-review-form";

describe("interview form prefill", () => {
  it("prefills the saved outcome and note", () => {
    expect(
      interviewFormFromReview({
        interview_outcome: "hold",
        notes: "Heard a clear call",
      })
    ).toEqual({ outcome: "hold", notes: "Heard a clear call" });
  });

  it("reads outcome and note when those are the field names on the row", () => {
    expect(
      interviewFormFromReview({
        outcome: "decline",
        note: "Not this year",
      })
    ).toEqual({ outcome: "decline", notes: "Not this year" });
  });

  it("reads interviewOutcome and interview_notes as well", () => {
    expect(
      interviewFormFromReview({
        interviewOutcome: "recommend",
        interview_notes: "Bring them in",
      })
    ).toEqual({ outcome: "recommend", notes: "Bring them in" });
  });

  it("stays on no decision yet when nothing has been saved", () => {
    expect(interviewFormFromReview(null)).toEqual({ outcome: "pending", notes: "" });
    expect(interviewFormFromReview({ interview_outcome: "accepted", notes: null })).toEqual({
      outcome: "pending",
      notes: "",
    });
  });

  it("prefills after the form mounted on the empty default and the saved row arrives", () => {
    const mounted = emptyInterviewDraft("app-1");
    const next = reconcileInterviewDraft(
      mounted,
      interviewFormFromReview({ interview_outcome: "recommend", notes: "Strong interview" }),
      "app-1"
    );
    expect(next.outcome).toBe("recommend");
    expect(next.notes).toBe("Strong interview");
    expect(next.baselineOutcome).toBe("recommend");
    expect(next.baselineNotes).toBe("Strong interview");
  });

  it("prefills the viewer's row when a refresh hands the form the saved fields", () => {
    const next = savedInterviewFor(
      [
        {
          application_response_id: "app-1",
          author_id: "staff",
          interview_outcome: "hold",
          notes: "Staff note",
        },
        {
          application_response_id: "app-1",
          author_id: "leader",
          outcome: "recommend",
          note: "Leader note",
        },
      ],
      "app-1",
      "leader"
    );
    expect(next).toEqual({ outcome: "recommend", notes: "Leader note" });
  });

  it("uses the mine flag when the saved row has no author id", () => {
    const row = ownInterviewReview(
      [
        { mine: false, author_id: "staff", notes: "Theirs", interview_outcome: "hold" },
        { mine: true, notes: "Mine", interview_outcome: "decline" },
      ],
      "leader"
    );
    expect(interviewFormFromReview(row)).toEqual({ outcome: "decline", notes: "Mine" });
  });

  it("does not take another reviewer's row when this reviewer has none", () => {
    expect(
      savedInterviewFor(
        [
          {
            application_response_id: "app-1",
            author_id: "staff",
            interview_outcome: "hold",
            notes: "Staff note",
          },
        ],
        "app-1",
        "leader"
      )
    ).toEqual({ outcome: "pending", notes: "" });
  });

  it("keeps a note the reviewer already typed when the saved row arrives late", () => {
    const typed = {
      ...emptyInterviewDraft("app-1"),
      notes: "Still writing",
    };
    const next = reconcileInterviewDraft(
      typed,
      { outcome: "hold", notes: "Saved" },
      "app-1"
    );
    expect(next).toBe(typed);
  });

  it("replaces the draft when the open application changes", () => {
    const previous = draftFromSaved({ outcome: "hold", notes: "Other person" }, "app-1");
    const next = reconcileInterviewDraft(
      previous,
      { outcome: "recommend", notes: "This person" },
      "app-2"
    );
    expect(next.applicationId).toBe("app-2");
    expect(next.outcome).toBe("recommend");
    expect(next.notes).toBe("This person");
  });

  it("applies an asynchronously loaded own row onto the empty default", () => {
    const next = nextDraftAfterLoad(
      emptyInterviewDraft("app-1"),
      [{ mine: true, interview_outcome: "hold", notes: "Heard a clear call" }],
      "leader"
    );
    expect(next.outcome).toBe("hold");
    expect(next.notes).toBe("Heard a clear call");
  });

  it("does not blank a prefilled draft when the load cannot tell whose row it is", () => {
    const prefilled = draftFromSaved({ outcome: "hold", notes: "Heard a clear call" }, "app-1");
    const next = nextDraftAfterLoad(
      prefilled,
      [{ interview_outcome: "hold", notes: "Heard a clear call" }],
      "leader"
    );
    expect(next).toBe(prefilled);
  });

  it("does not blank a prefilled draft when the load comes back empty", () => {
    const prefilled = draftFromSaved({ outcome: "hold", notes: "Heard a clear call" }, "app-1");
    expect(nextDraftAfterLoad(prefilled, [], "leader")).toBe(prefilled);
  });
});

describe("explicit clear flags", () => {
  it("does not ask to clear when the form is still the empty default", () => {
    expect(interviewClearFlags(emptyInterviewDraft("app-1"))).toEqual({
      clear_outcome: false,
      clear_notes: false,
    });
  });

  it("asks to clear only after the reviewer changes a loaded outcome or note", () => {
    const loaded = draftFromSaved({ outcome: "hold", notes: "Heard a clear call" }, "app-1");
    expect(interviewClearFlags({ ...loaded, outcome: "pending" })).toEqual({
      clear_outcome: true,
      clear_notes: false,
    });
    expect(interviewClearFlags({ ...loaded, notes: "" })).toEqual({
      clear_outcome: false,
      clear_notes: true,
    });
    expect(interviewClearFlags({ ...loaded, outcome: "recommend", notes: "Now a yes" })).toEqual({
      clear_outcome: false,
      clear_notes: false,
    });
  });
});

describe("interview re-save does not blank a stored outcome", () => {
  const existing = { notes: "Heard a clear call", interview_outcome: "hold" };

  it("keeps the stored outcome and note when the form sends the empty default", () => {
    expect(
      preserveInterviewWrite({
        existing,
        notes: "",
        outcome: "pending",
        clearOutcome: false,
        clearNotes: false,
      })
    ).toEqual({ notes: "Heard a clear call", outcome: "hold" });
  });

  it("keeps a stored note when the outcome was already pending", () => {
    expect(
      preserveInterviewWrite({
        existing: { notes: "Still thinking", interview_outcome: "pending" },
        notes: "",
        outcome: "pending",
        clearOutcome: false,
        clearNotes: false,
      })
    ).toEqual({ notes: "Still thinking", outcome: "pending" });
  });

  it("clears the outcome and the note when the reviewer explicitly chooses to", () => {
    expect(
      preserveInterviewWrite({
        existing,
        notes: "",
        outcome: "pending",
        clearOutcome: true,
        clearNotes: true,
      })
    ).toEqual({ notes: null, outcome: "pending" });
  });

  it("does not treat a non-boolean clear flag as an explicit choice", () => {
    expect(
      preserveInterviewWrite({
        existing,
        notes: "",
        outcome: "pending",
        clearOutcome: "true" as unknown as boolean,
        clearNotes: false,
      })
    ).toEqual({ notes: "Heard a clear call", outcome: "hold" });
  });

  it("saves a real change of outcome and note", () => {
    expect(
      preserveInterviewWrite({
        existing,
        notes: "Now a yes",
        outcome: "recommend",
        clearOutcome: false,
        clearNotes: false,
      })
    ).toEqual({ notes: "Now a yes", outcome: "recommend" });
  });

  it("can store a first review that is still pending", () => {
    expect(
      preserveInterviewWrite({
        existing: null,
        notes: "",
        outcome: "pending",
        clearOutcome: false,
        clearNotes: false,
      })
    ).toEqual({ notes: null, outcome: "pending" });
  });
});
