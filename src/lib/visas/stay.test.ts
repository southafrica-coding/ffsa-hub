import { describe, expect, it } from "vitest";
import {
  splitStays,
  addMonths,
  computeStay,
  daysInclusive,
  deadlines,
  isTooOld,
  passportValidForStay,
  requiredDocuments,
  visaNeed,
} from "./stay";

describe("computeStay", () => {
  it("FFBX alone: the school's own dates (88 days)", () => {
    expect(computeStay([{ startDate: "2026-09-08", endDate: "2026-12-04" }])).toEqual({
      from: "2026-09-08",
      to: "2026-12-04",
      days: 88,
    });
  });

  it("FFX then FFBX: first arrival to last departure", () => {
    const stay = computeStay([
      { startDate: "2026-09-08", endDate: "2026-12-04" },
      { startDate: "2026-06-01", endDate: "2026-08-28" },
    ]);
    expect(stay).toEqual({ from: "2026-06-01", to: "2026-12-04", days: 187 });
  });

  it("uses arrival and departure days when a school has them", () => {
    const stay = computeStay([
      { startDate: "2026-09-08", endDate: "2026-12-04", arrivalDate: "2026-09-05", departureDate: "2026-12-06" },
    ]);
    expect(stay).toEqual({ from: "2026-09-05", to: "2026-12-06", days: 93 });
  });

  it("ignores schools without both dates, and returns null when none have them", () => {
    expect(computeStay([{ startDate: null, endDate: "2026-12-04" }])).toBeNull();
    expect(computeStay([])).toBeNull();
    expect(
      computeStay([
        { startDate: null, endDate: null },
        { startDate: "2027-01-10", endDate: "2027-04-08" },
      ])
    ).toEqual({ from: "2027-01-10", to: "2027-04-08", days: 89 });
  });

  it("rejects a school that ends before it starts, and bad dates", () => {
    expect(() => computeStay([{ startDate: "2026-12-04", endDate: "2026-09-08" }])).toThrow();
    expect(() => computeStay([{ startDate: "8 Sep 2026", endDate: "2026-12-04" }])).toThrow();
  });
});

describe("visaNeed", () => {
  it("90-day-exempt passport, one ~90-day school: no visa", () => {
    expect(visaNeed(88, 90)).toEqual({ needed: false, type: "exempt", nearLimit: true });
  });

  it("90-day-exempt passport just over the limit: visitor's visa, flagged", () => {
    expect(visaNeed(93, 90)).toEqual({ needed: true, type: "volunteer", nearLimit: true });
  });

  it("over 90 days needs the voluntary-activities visa even when exempt", () => {
    expect(visaNeed(187, 90)).toEqual({ needed: true, type: "volunteer", nearLimit: false });
    expect(visaNeed(270, 90).type).toBe("volunteer"); // FFSBI, 9 months
  });

  it("30-day exemption or none: a ~90-day school needs a visitor's visa", () => {
    expect(visaNeed(88, 30)).toEqual({ needed: true, type: "visitor", nearLimit: false });
    expect(visaNeed(88, 0)).toEqual({ needed: true, type: "visitor", nearLimit: false });
    expect(visaNeed(10, 0).needed).toBe(true);
  });

  it("a short stay inside a 30-day exemption needs nothing", () => {
    expect(visaNeed(25, 30)).toEqual({ needed: false, type: "exempt", nearLimit: true });
    expect(visaNeed(14, 30).nearLimit).toBe(false);
  });

  it("exactly 90 days is still a short stay", () => {
    expect(visaNeed(90, 90).needed).toBe(false);
    expect(visaNeed(90, 0).type).toBe("visitor");
  });
});

describe("deadlines", () => {
  it("works back from arrival: processing weeks + margin, then lead time", () => {
    expect(deadlines("2027-01-10", 6, 8)).toEqual({
      lodgeBy: "2026-11-15", // 10 Jan − 42 − 14 days
      startDocumentsBy: "2026-09-20", // − 8 weeks
    });
  });

  it("is unknown until the embassy's processing time is known", () => {
    expect(deadlines("2027-01-10", null, 8)).toBeNull();
  });
});

describe("document age and passport validity", () => {
  it("clamps month maths to the month's last day", () => {
    expect(addMonths("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonths("2027-11-30", 3)).toBe("2028-02-29");
  });

  it("a medical report older than 6 months by lodging is too old", () => {
    expect(isTooOld("2026-05-01", 6, "2026-11-15")).toBe(true);
    expect(isTooOld("2026-06-01", 6, "2026-11-15")).toBe(false);
    expect(isTooOld("2026-05-15", 6, "2026-11-15")).toBe(false); // exactly 6 months
    expect(isTooOld("2010-01-01", null, "2026-11-15")).toBe(false);
  });

  it("passport must be valid 30 days past the last departure day", () => {
    expect(passportValidForStay("2027-01-03", "2026-12-04")).toBe(true);
    expect(passportValidForStay("2027-01-02", "2026-12-04")).toBe(false);
    expect(daysInclusive("2026-12-04", "2027-01-03")).toBe(31);
  });
});

describe("requiredDocuments", () => {
  const types = [
    { code: "passport", needed_up_to_90: true, needed_over_90: true, is_active: true },
    { code: "police_clearance", needed_up_to_90: false, needed_over_90: true, is_active: true },
    { code: "retired", needed_up_to_90: true, needed_over_90: true, is_active: false },
  ];

  it("short list up to 90 days, long list beyond, never inactive types", () => {
    expect(requiredDocuments(types, 88).map((t) => t.code)).toEqual(["passport"]);
    expect(requiredDocuments(types, 187).map((t) => t.code)).toEqual(["passport", "police_clearance"]);
  });
});

describe("splitStays (gap rule)", () => {
  const school = (start: string, end: string) => ({ startDate: start, endDate: end });

  it("one visa covers two schools and a gap of up to 90 days", () => {
    const out = splitStays([school("2027-07-01", "2027-09-30"), school("2027-01-10", "2027-04-08")]);
    // 9 Apr – 30 Jun is 83 days between schools.
    expect(out).toHaveLength(1);
    expect(out[0].stay).toEqual({ from: "2027-01-10", to: "2027-09-30", days: 264 });
    expect(out[0].schools.map((s) => s.startDate)).toEqual(["2027-01-10", "2027-07-01"]);
  });

  it("a gap of exactly 90 days still shares a visa; 91 days splits", () => {
    // Leave 1 Mar; days between = arrive − 2 Mar.
    const first = school("2027-01-01", "2027-03-01");
    expect(splitStays([first, school("2027-05-31", "2027-07-01")])).toHaveLength(1); // 2 Mar–30 May = 90
    expect(splitStays([first, school("2027-06-01", "2027-07-01")])).toHaveLength(2); // 91
  });

  it("overlapping or back-to-back schools are one stay; undated schools are left out", () => {
    const out = splitStays([
      school("2027-01-10", "2027-04-08"),
      school("2027-04-09", "2027-06-30"),
      { startDate: null, endDate: null },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].schools).toHaveLength(2);
  });
});
