import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PIPELINE_TABS,
  derivePipelineStage,
  interviewOutcomeBadge,
  requiredReferencesComplete,
  statusAfterReferencesComplete,
  type InterviewReviewFact,
  type ReferenceRequestFact,
} from "./applicant-pipeline-stage";

const FRIEND = "slot-friend";
const LEADER = "slot-leader";
const REQUIRED = [FRIEND, LEADER];

function refs(...rows: ReferenceRequestFact[]): ReferenceRequestFact[] {
  return rows;
}

function review(
  outcome: string | null,
  updatedAt = "2026-11-09T12:00:00Z"
): InterviewReviewFact {
  return { interviewOutcome: outcome, updatedAt };
}

describe("required reference counts", () => {
  it("is complete only when every required slot has a submitted request", () => {
    expect(
      requiredReferencesComplete(
        REQUIRED,
        refs(
          { slotId: FRIEND, status: "submitted" },
          { slotId: LEADER, status: "submitted" }
        )
      )
    ).toBe(true);
  });

  it("stays incomplete when one required slot is still pending", () => {
    expect(
      requiredReferencesComplete(
        REQUIRED,
        refs(
          { slotId: FRIEND, status: "submitted" },
          { slotId: LEADER, status: "pending" }
        )
      )
    ).toBe(false);
  });

  it("does not count a status other than submitted", () => {
    expect(
      requiredReferencesComplete(
        REQUIRED,
        refs(
          { slotId: FRIEND, status: "submitted" },
          { slotId: LEADER, status: "complete" }
        )
      )
    ).toBe(false);
  });

  it("treats a submitted row as enough even if that slot also has a pending row", () => {
    expect(
      requiredReferencesComplete(
        REQUIRED,
        refs(
          { slotId: FRIEND, status: "pending" },
          { slotId: FRIEND, status: "submitted" },
          { slotId: LEADER, status: "submitted" }
        )
      )
    ).toBe(true);
  });

  it("does not let an optional pending reference block the required ones", () => {
    expect(
      requiredReferencesComplete(
        REQUIRED,
        refs(
          { slotId: FRIEND, status: "submitted" },
          { slotId: LEADER, status: "submitted" },
          { slotId: "slot-optional", status: "pending" }
        )
      )
    ).toBe(true);
  });

  it("is incomplete when a required slot has no request row", () => {
    expect(
      requiredReferencesComplete(REQUIRED, refs({ slotId: FRIEND, status: "submitted" }))
    ).toBe(false);
  });

  it("does not treat a program with no required slots as complete", () => {
    expect(
      requiredReferencesComplete([], refs({ slotId: FRIEND, status: "submitted" }))
    ).toBe(false);
  });
});

describe("pipeline stage", () => {
  const bothIn = refs(
    { slotId: FRIEND, status: "submitted" },
    { slotId: LEADER, status: "submitted" }
  );

  it("shows both-refs-in under References received while the row is still waiting_for_references", () => {
    expect(
      derivePipelineStage({
        storedStatus: "waiting_for_references",
        requiredSlotIds: REQUIRED,
        requests: bothIn,
        reviews: [],
      })
    ).toBe("references_received");
  });

  it("shows a stored submitted application under References received once both refs are in", () => {
    expect(
      derivePipelineStage({
        storedStatus: "submitted",
        requiredSlotIds: REQUIRED,
        requests: bothIn,
        reviews: [],
      })
    ).toBe("references_received");
  });

  it("folds waiting_for_references into Submitted while a required ref is still out", () => {
    expect(
      derivePipelineStage({
        storedStatus: "waiting_for_references",
        requiredSlotIds: REQUIRED,
        requests: refs(
          { slotId: FRIEND, status: "submitted" },
          { slotId: LEADER, status: "pending" }
        ),
        reviews: [],
      })
    ).toBe("submitted");
  });

  it("leaves a brand-new application with no refs under Submitted", () => {
    expect(
      derivePipelineStage({
        storedStatus: "submitted",
        requiredSlotIds: REQUIRED,
        requests: refs(
          { slotId: FRIEND, status: "pending" },
          { slotId: LEADER, status: "pending" }
        ),
        reviews: [],
      })
    ).toBe("submitted");
  });

  it("does not pull interview_scheduled back when the refs are in", () => {
    expect(
      derivePipelineStage({
        storedStatus: "interview_scheduled",
        requiredSlotIds: REQUIRED,
        requests: bothIn,
        reviews: [],
      })
    ).toBe("interview_scheduled");
  });

  it("does not demote a references_received row staff set before every ref arrived", () => {
    expect(
      derivePipelineStage({
        storedStatus: "references_received",
        requiredSlotIds: REQUIRED,
        requests: refs({ slotId: FRIEND, status: "pending" }),
        reviews: [],
      })
    ).toBe("references_received");
  });

  it("puts a decisive interview outcome on Interview complete, including a stored submitted row", () => {
    expect(
      derivePipelineStage({
        storedStatus: "submitted",
        requiredSlotIds: REQUIRED,
        requests: bothIn,
        reviews: [review("hold")],
      })
    ).toBe("interview_complete");
  });

  it("does not treat notes with a pending outcome as a finished interview", () => {
    expect(
      derivePipelineStage({
        storedStatus: "submitted",
        requiredSlotIds: REQUIRED,
        requests: bothIn,
        reviews: [review("pending")],
      })
    ).toBe("references_received");
  });

  it("moves interview_scheduled onto Interview complete once an outcome is saved", () => {
    expect(
      derivePipelineStage({
        storedStatus: "interview_scheduled",
        requiredSlotIds: REQUIRED,
        requests: bothIn,
        reviews: [review("recommend")],
      })
    ).toBe("interview_complete");
  });

  it("leaves an accepted application on Accepted even with an interview outcome", () => {
    expect(
      derivePipelineStage({
        storedStatus: "accepted",
        requiredSlotIds: REQUIRED,
        requests: bothIn,
        reviews: [review("recommend")],
      })
    ).toBe("accepted");
  });

  it("leaves rejected, waitlisted, and cancelled where they were stored", () => {
    for (const storedStatus of ["rejected", "waitlisted", "cancelled"]) {
      expect(
        derivePipelineStage({
          storedStatus,
          requiredSlotIds: REQUIRED,
          requests: bothIn,
          reviews: [review("decline")],
        })
      ).toBe(storedStatus);
    }
  });

  it("never returns the waiting_for_references tab", () => {
    const stage = derivePipelineStage({
      storedStatus: "waiting_for_references",
      requiredSlotIds: REQUIRED,
      requests: refs({ slotId: FRIEND, status: "pending" }, { slotId: LEADER, status: "pending" }),
      reviews: [],
    });
    expect(stage).not.toBe("waiting_for_references");
  });
});

describe("interview outcome badge", () => {
  it("uses the latest decisive outcome when more than one review decided", () => {
    expect(
      interviewOutcomeBadge([
        review("hold", "2026-11-01T00:00:00Z"),
        review("decline", "2026-11-09T00:00:00Z"),
      ])
    ).toBe("decline");
  });

  it("is null when the only outcome is pending", () => {
    expect(interviewOutcomeBadge([review("pending")])).toBeNull();
  });
});

describe("status write after the last required reference", () => {
  const bothIn = refs(
    { slotId: FRIEND, status: "submitted" },
    { slotId: LEADER, status: "submitted" }
  );

  it("advances submitted and waiting_for_references", () => {
    expect(
      statusAfterReferencesComplete({
        storedStatus: "waiting_for_references",
        requiredSlotIds: REQUIRED,
        requests: bothIn,
      })
    ).toBe("references_received");
    expect(
      statusAfterReferencesComplete({
        storedStatus: "submitted",
        requiredSlotIds: REQUIRED,
        requests: bothIn,
      })
    ).toBe("references_received");
  });

  it("does not advance a later stage or an application still short a required ref", () => {
    expect(
      statusAfterReferencesComplete({
        storedStatus: "interview_scheduled",
        requiredSlotIds: REQUIRED,
        requests: bothIn,
      })
    ).toBeNull();
    expect(
      statusAfterReferencesComplete({
        storedStatus: "accepted",
        requiredSlotIds: REQUIRED,
        requests: bothIn,
      })
    ).toBeNull();
    expect(
      statusAfterReferencesComplete({
        storedStatus: "submitted",
        requiredSlotIds: REQUIRED,
        requests: refs(
          { slotId: FRIEND, status: "submitted" },
          { slotId: LEADER, status: "pending" }
        ),
      })
    ).toBeNull();
  });
});

describe("pipeline tab order", () => {
  it("is All, Submitted, References received, Interview scheduled, Interview complete, Accepted, Waitlisted, Rejected, Cancelled, Unassigned", () => {
    expect(PIPELINE_TABS.map((tab) => tab.label)).toEqual([
      "All",
      "Submitted",
      "References received",
      "Interview scheduled",
      "Interview complete",
      "Accepted",
      "Waitlisted",
      "Rejected",
      "Cancelled",
      "Unassigned",
    ]);
  });
});

describe("stale reference status script", () => {
  const sql = readFileSync(
    path.resolve(__dirname, "../../../scripts/not-run/advance-stale-reference-statuses.sql"),
    "utf8"
  );
  const executable = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  it("is marked not run and only advances early stages when every required slot is submitted", () => {
    expect(sql.startsWith("--")).toBe(true);
    expect(sql).toMatch(/NOT RUN/);
    expect(executable).toMatch(/ar\.status IN \('submitted', 'waiting_for_references'\)/);
    expect(executable).toMatch(/SET status = 'references_received'/);
    expect(executable).toMatch(/rs\.is_required/);
    expect(executable).toMatch(/rr\.status = 'submitted'/);
    expect(executable).not.toMatch(/SET status = 'submitted'/);
    expect(executable).not.toMatch(/interview_complete/);
    expect(executable).not.toMatch(/interview_scheduled/);
    expect(executable).not.toMatch(/'accepted'/);
  });
});
