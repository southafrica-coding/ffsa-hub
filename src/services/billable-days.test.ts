import { describe, expect, it } from "vitest";
import { billableDays, dayCount } from "./vehicles";

// Gideon, 24 Nov 2026: "The due back day should not be quoted."
describe("billableDays", () => {
  it("counts collection to the last day needed, not the due-back morning", () => {
    // Collected Mon 30 Nov, needed until Thu 3 Dec, due back Fri 4 Dec → 4 days.
    expect(dayCount("2026-11-30", "2026-12-04")).toBe(5);
    expect(billableDays("2026-11-30", "2026-12-04")).toBe(4);
  });
  it("is never less than one day", () => {
    expect(billableDays("2026-11-30", "2026-12-01")).toBe(1);
    expect(billableDays("2026-11-30", "2026-11-30")).toBe(1);
  });
});
