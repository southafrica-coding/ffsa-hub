import { describe, expect, it } from "vitest";
import { endDateFor, isAfterDatabaseToday, todayIsoDate } from "@/lib/missio/dates";

describe("todayIsoDate", () => {
  it("stays on the UTC date and does not use the SAST civil date", () => {
    // 00:30 SAST is still the previous UTC date.
    expect(todayIsoDate(new Date("2026-11-18T00:30:00+02:00"))).toBe("2026-11-17");
    // 02:30 SAST is the same UTC date.
    expect(todayIsoDate(new Date("2026-11-18T02:30:00+02:00"))).toBe("2026-11-18");
    expect(endDateFor(new Date("2026-11-18T00:30:00+02:00"))).toBe("2026-11-17");
  });

  it("treats a later ISO date as after the database today", () => {
    expect(isAfterDatabaseToday("2099-01-01", "2026-11-18")).toBe(true);
    expect(isAfterDatabaseToday("2026-11-18", "2026-11-18")).toBe(false);
    expect(isAfterDatabaseToday("2026-01-01", "2026-11-18")).toBe(false);
  });
});
