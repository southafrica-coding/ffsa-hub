import { describe, expect, it } from "vitest";
import { canAgreeCredits, checkSplits, splitsTotal } from "./splits";
import {
  canMovePlacement,
  canMoveStage,
  isFinished,
  libraryState,
  nextStage,
  pathwaySteps,
  stageMoveOptions,
  stageNumber,
} from "./stages";
import { isStuck, lastProgress, sortForBoard, stagesWithStuck, stuckDays, stuckInfo } from "./stuck";
import { refineProgress } from "./refine";
import { SONG_STAGES } from "./types";

const NOW = new Date("2026-11-26T10:00:00+02:00");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("splits must total 100%", () => {
  it("agrees at exactly 100", () => {
    const rows = [{ split_pct: 50 }, { split_pct: 35 }, { split_pct: 15 }];
    expect(checkSplits(rows)).toEqual({ ok: true, totalPct: 100 });
    expect(canAgreeCredits(rows)).toBe(true);
  });

  it("adds two-decimal splits without float drift", () => {
    const rows = [{ split_pct: 33.33 }, { split_pct: 33.33 }, { split_pct: 33.34 }];
    expect(splitsTotal(rows)).toBe(100);
    expect(checkSplits(rows).ok).toBe(true);
  });

  it("blocks at 95% with the mockup's message", () => {
    const result = checkSplits([{ split_pct: 50 }, { split_pct: 35 }, { split_pct: 10 }]);
    expect(result).toMatchObject({ ok: false, totalPct: 95, reason: "under" });
    expect(!result.ok && result.message).toBe("Splits add up to 95%. Add 5% somewhere before credits can be agreed.");
  });

  it("blocks over 100, a missing split, and no writers", () => {
    expect(checkSplits([{ split_pct: 60 }, { split_pct: 50 }])).toMatchObject({ ok: false, reason: "over", totalPct: 110 });
    expect(checkSplits([{ split_pct: 100 }, { split_pct: null }])).toMatchObject({ ok: false, reason: "missing" });
    expect(checkSplits([])).toMatchObject({ ok: false, reason: "empty" });
    expect(canAgreeCredits([{ split_pct: 99.99 }])).toBe(false);
  });
});

describe("stuck rule", () => {
  it("counts whole days since the last progress", () => {
    expect(stuckDays(daysAgo(0), NOW)).toBe(0);
    expect(stuckDays(daysAgo(13.9), NOW)).toBe(13);
    expect(stuckDays(daysAgo(14), NOW)).toBe(14);
    expect(stuckDays(new Date(NOW.getTime() + 5_000).toISOString(), NOW)).toBe(0);
  });

  it("is stuck at 14 days by default", () => {
    expect(isStuck("writing", 13)).toBe(false);
    expect(isStuck("writing", 14)).toBe(true);
    expect(isStuck("written_needs_demo", 23)).toBe(true);
  });

  it("allows only 7 days in Set it down", () => {
    expect(isStuck("set_down", 6)).toBe(false);
    expect(isStuck("set_down", 7)).toBe(true);
  });

  it("never marks Celebrate as stuck", () => {
    expect(isStuck("celebrate", 0)).toBe(false);
    expect(isStuck("celebrate", 400)).toBe(false);
  });

  it("resets the clock on any progress event", () => {
    const created = daysAgo(30);
    expect(isStuck("refine", stuckDays(lastProgress(created, []), NOW))).toBe(true);
    // A refine tick (or a version, placement, checkpoint, pathway step) 2 days ago.
    const latest = lastProgress(created, [{ at: daysAgo(20) }, { at: daysAgo(2) }, { at: daysAgo(9) }]);
    expect(latest).toBe(daysAgo(2));
    expect(isStuck("refine", stuckDays(latest, NOW))).toBe(false);
  });

  it("prefers the server's status when it has one", () => {
    expect(stuckInfo("writing", daysAgo(30), NOW, { stuck_days: 3, is_stuck: false })).toEqual({ days: 3, stuck: false });
    expect(stuckInfo("writing", daysAgo(30), NOW)).toEqual({ days: 30, stuck: true });
  });

  it("sorts stuck first and flags the stage tiles", () => {
    const rows = [
      { id: "a", stage: "writing" as const, stuck: false, days: 4 },
      { id: "b", stage: "written_needs_demo" as const, stuck: true, days: 16 },
      { id: "c", stage: "written_needs_demo" as const, stuck: true, days: 23 },
      { id: "d", stage: "refine" as const, stuck: false, days: 1 },
    ];
    expect(sortForBoard(rows).map((r) => r.id)).toEqual(["c", "b", "d", "a"]);
    expect([...stagesWithStuck(rows)]).toEqual(["written_needs_demo"]);
  });
});

describe("stage transitions", () => {
  // Rule: any P&W member (manager) may move a song to any other stage,
  // forwards or back, and may skip Set it down. A song's writers may move it
  // only among Idea / Entry … Written, needs demo. Nobody else moves it.
  it("keeps the eight stages in order", () => {
    expect(SONG_STAGES).toEqual([
      "idea_entry",
      "writing",
      "set_down",
      "refine",
      "written_needs_demo",
      "demo_ready",
      "share",
      "celebrate",
    ]);
    expect(stageNumber("refine")).toBe(4);
    expect(nextStage("refine")).toBe("written_needs_demo");
    expect(nextStage("celebrate")).toBeNull();
  });

  it("lets a P&W member skip Set it down and move anywhere", () => {
    expect(canMoveStage("manager", "writing", "refine")).toBe(true);
    expect(canMoveStage("manager", "writing", "set_down")).toBe(true);
    expect(canMoveStage("manager", "share", "refine")).toBe(true);
    expect(canMoveStage("manager", "idea_entry", "celebrate")).toBe(true);
    expect(canMoveStage("manager", "refine", "refine")).toBe(false);
    expect(stageMoveOptions("manager", "refine")).toHaveLength(7);
  });

  it("lets writers skip Set it down but not reach Demo ready", () => {
    expect(canMoveStage("writer", "writing", "refine")).toBe(true);
    expect(canMoveStage("writer", "refine", "written_needs_demo")).toBe(true);
    expect(canMoveStage("writer", "written_needs_demo", "demo_ready")).toBe(false);
    expect(canMoveStage("writer", "demo_ready", "refine")).toBe(false);
    expect(stageMoveOptions("writer", "writing")).toEqual(["idea_entry", "set_down", "refine", "written_needs_demo"]);
  });

  it("does not need the bonus Refine question to move on", () => {
    const progress = refineProgress([{ q_no: 1, checked: true }, { q_no: 11, checked: false }]);
    expect(progress).toEqual({ done: 1, bonus: false });
    expect(canMoveStage("manager", "refine", "written_needs_demo")).toBe(true);
  });

  it("gives other people no moves, and placement only to P&W members", () => {
    expect(stageMoveOptions("none", "writing")).toEqual([]);
    expect(canMovePlacement("manager", "inbox", "prayer_sets")).toBe(true);
    expect(canMovePlacement("writer", "inbox", "prayer_sets")).toBe(false);
  });

  it("groups stages into the library chips", () => {
    expect(libraryState("written_needs_demo")).toBe("needs_demo");
    expect(libraryState("refine")).toBe("in_process");
    expect(libraryState("demo_ready")).toBe("finished");
    expect(isFinished("celebrate")).toBe(true);
  });

  it("orders the pathway branches", () => {
    expect(pathwaySteps("melody", "b1")).toEqual(["lyric", "instrumental"]);
    expect(pathwaySteps("melody", "b2")).toEqual(["instrumental", "lyric"]);
  });
});
