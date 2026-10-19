import { describe, it, expect } from "vitest";
import {
  comingWeekend,
  dayCount,
  dayLabel,
  monthGrid,
  rangeLabel,
  readRange,
  sastToday,
  shiftMonth,
} from "./dates";

describe("hire dates", () => {
  it("counts days inclusively", () => {
    expect(dayCount("2026-11-06", "2026-11-09")).toBe(4);
    expect(dayCount("2026-11-06", "2026-11-06")).toBe(1);
  });

  it("finds the coming Fri → Mon", () => {
    expect(comingWeekend("2026-10-19")).toEqual({ from: "2026-10-23", to: "2026-10-26" }); // Monday
    expect(comingWeekend("2026-10-23")).toEqual({ from: "2026-10-23", to: "2026-10-26" }); // Friday itself
    expect(comingWeekend("2026-10-24")).toEqual({ from: "2026-10-30", to: "2026-11-02" }); // Saturday
  });

  it("takes today on the SAST calendar", () => {
    expect(sastToday(new Date("2026-10-19T22:30:00Z"))).toBe("2026-10-20");
  });

  it("reads good dates and falls back on bad ones", () => {
    const today = "2026-10-19";
    expect(readRange({ from: "2026-11-06", to: "2026-11-09" }, today)).toEqual({
      from: "2026-11-06",
      to: "2026-11-09",
      chosen: true,
    });
    for (const bad of [
      {},
      { from: "2026-11-09", to: "2026-11-06" }, // backwards
      { from: "2026-10-01", to: "2026-10-03" }, // past
      { from: "nope", to: "2026-11-06" },
    ]) {
      expect(readRange(bad, today)).toEqual({ from: "2026-10-23", to: "2026-10-26", chosen: false });
    }
  });

  it("labels days and ranges the way the frames do", () => {
    expect(dayLabel("2026-11-06")).toBe("Fri 6 Nov");
    expect(rangeLabel("2026-11-06", "2026-11-09")).toBe("Fri 6 – Mon 9 Nov");
    expect(rangeLabel("2026-11-30", "2026-12-02")).toBe("Mon 30 Nov – Wed 2 Dec");
  });

  it("builds a Monday-first month grid", () => {
    const g = monthGrid("2026-11");
    expect(g).toHaveLength(42);
    expect(g[0]).toBe("2026-10-26"); // 1 Nov 2026 is a Sunday
    expect(g[6]).toBe("2026-11-01");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});
