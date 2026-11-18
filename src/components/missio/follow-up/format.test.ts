import { describe, expect, it } from "vitest";
import { displayEnum, entryText, formatWhen, newestFirst } from "./format";
import type { TimelineEntry } from "./types";

describe("follow-up display", () => {
  it("capitalises weekday tokens and leaves other words alone", () => {
    expect(displayEnum("thursday")).toBe("Thursday");
    expect(displayEnum("THURSDAY")).toBe("Thursday");
    expect(displayEnum(" Thursday ")).toBe("Thursday");
    expect(displayEnum("Thursday evening")).toBe("Thursday evening");
    expect(displayEnum(null)).toBe("");
  });

  it("formats a submitted date in Johannesburg and sorts the timeline newest first", () => {
    expect(formatWhen("2026-11-16T08:30:00.000Z")).toBe("16 Nov 2026");
    expect(formatWhen("2026-11-16T08:30:00.000Z", true)).toContain("16 Nov 2026");
    expect(formatWhen(null)).toBeNull();
    const older: TimelineEntry = {
      id: "old",
      kind: "submitted",
      fromStage: null,
      toStage: null,
      body: null,
      by: null,
      at: "2026-11-01T08:00:00.000Z",
    };
    const newer: TimelineEntry = { ...older, id: "new", kind: "note", body: "Called her.", at: "2026-11-16T08:30:00.000Z" };
    expect(newestFirst([older, newer]).map((entry) => entry.id)).toEqual(["new", "old"]);
    expect(entryText(newer)).toBe("Called her.");
    expect(entryText({ ...older, kind: "stage_change", fromStage: "new", toStage: "contacted" })).toBe(
      "Moved from New to Contacted"
    );
  });
});
