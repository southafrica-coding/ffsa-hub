import { describe, expect, it } from "vitest";
import { currentQuarter, isQuarter, parseQuarter, quarterOf } from "./quarter";

describe("quarterOf", () => {
  it("uses the SAST calendar, including the New Year boundary", () => {
    expect(quarterOf(new Date("2026-11-10T12:00:00.000Z"))).toBe("2026-Q4");
    expect(quarterOf(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-Q1");
    expect(quarterOf(new Date("2026-03-31T21:59:00.000Z"))).toBe("2026-Q1");
    expect(quarterOf(new Date("2026-03-31T22:00:00.000Z"))).toBe("2026-Q2");
    expect(quarterOf(new Date("2026-12-31T21:59:00.000Z"))).toBe("2026-Q4");
    expect(quarterOf(new Date("2026-12-31T22:00:00.000Z"))).toBe("2027-Q1");
  });
});

describe("parseQuarter", () => {
  it("defaults a missing quarter to the current one and rejects a bad label", () => {
    expect(parseQuarter(null)).toEqual({ ok: true, quarter: currentQuarter() });
    expect(parseQuarter("")).toEqual({ ok: true, quarter: currentQuarter() });
    expect(parseQuarter("2026-Q3")).toEqual({ ok: true, quarter: "2026-Q3" });
    expect(parseQuarter("2026-Q5").ok).toBe(false);
    expect(parseQuarter("Q4").ok).toBe(false);
    expect(isQuarter("2026-Q4")).toBe(true);
  });
});
