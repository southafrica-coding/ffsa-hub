import { describe, it, expect } from "vitest";
import { reconcileSeries, type SeriesOccurrence } from "./series-reconcile";

// A Tuesday run: 3, 10, 17, 24 March 2026. "Today" is Wed 11 March, so the
// first two dates are in the past.
const TUESDAYS: SeriesOccurrence[] = [
  { id: "a", booking_date: "2026-03-03", status: "approved" },
  { id: "b", booking_date: "2026-03-10", status: "approved" },
  { id: "c", booking_date: "2026-03-17", status: "approved" },
  { id: "d", booking_date: "2026-03-24", status: "approved" },
];
const TODAY = "2026-03-11";

const dates = (rows: SeriesOccurrence[]) => rows.map((r) => r.booking_date);

describe("reconcileSeries", () => {
  it("is a no-op when nothing changes", () => {
    const p = reconcileSeries(TUESDAYS, TODAY, 2, "2026-03-03", "2026-03-24");
    expect(p.add).toEqual([]);
    expect(p.remove).toEqual([]);
    expect(dates(p.keep)).toEqual(["2026-03-17", "2026-03-24"]);
    expect(dates(p.frozen)).toEqual(["2026-03-03", "2026-03-10"]);
  });

  it("moves only future dates when the weekday shifts", () => {
    const p = reconcileSeries(TUESDAYS, TODAY, 3, "2026-03-03", "2026-03-24");
    // 25 March is a Wednesday but falls outside the run, so the shift trades
    // two Tuesdays for one Wednesday — the dry run shows that before saving.
    expect(p.add).toEqual(["2026-03-18"]);
    expect(dates(p.remove)).toEqual(["2026-03-17", "2026-03-24"]);
    // The past Tuesdays are untouched.
    expect(dates(p.frozen)).toEqual(["2026-03-03", "2026-03-10"]);
    expect(p.keep).toEqual([]);
  });

  it("adds dates when the run is extended", () => {
    const p = reconcileSeries(TUESDAYS, TODAY, 2, "2026-03-03", "2026-04-14");
    expect(p.add).toEqual(["2026-03-31", "2026-04-07", "2026-04-14"]);
    expect(p.remove).toEqual([]);
    expect(dates(p.keep)).toEqual(["2026-03-17", "2026-03-24"]);
  });

  it("drops future dates when the run is shortened", () => {
    const p = reconcileSeries(TUESDAYS, TODAY, 2, "2026-03-03", "2026-03-17");
    expect(p.add).toEqual([]);
    expect(dates(p.remove)).toEqual(["2026-03-24"]);
    expect(dates(p.keep)).toEqual(["2026-03-17"]);
  });

  it("never deletes or re-adds a past date when the start moves later", () => {
    const p = reconcileSeries(TUESDAYS, TODAY, 2, "2026-03-17", "2026-03-24");
    expect(p.add).toEqual([]);
    expect(p.remove).toEqual([]);
    expect(dates(p.frozen)).toEqual(["2026-03-03", "2026-03-10"]);
  });

  it("keeps past dates even when the start moves earlier", () => {
    const p = reconcileSeries(TUESDAYS, TODAY, 2, "2026-02-01", "2026-03-24");
    // Past Tuesdays in the widened window are NOT created retroactively.
    expect(p.add).toEqual([]);
    expect(dates(p.frozen)).toEqual(["2026-03-03", "2026-03-10"]);
  });

  it("treats a duplicate row for a wanted date as removable", () => {
    const withDupe = [...TUESDAYS, { id: "c2", booking_date: "2026-03-17", status: "pending" }];
    const p = reconcileSeries(withDupe, TODAY, 2, "2026-03-03", "2026-03-24");
    expect(dates(p.remove)).toEqual(["2026-03-17"]);
    expect(p.remove[0].id).toBe("c2");
  });
});
