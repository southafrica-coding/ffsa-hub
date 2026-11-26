import { describe, expect, it } from "vitest";
import { countLeaveDays, daysInYear, partsFit, saHolidayName } from "./days";

describe("countLeaveDays: weekdays only", () => {
  it("skips Saturdays and Sundays", () => {
    // Thu 26 Nov – Tue 1 Dec 2026: Thu, Fri, Mon, Tue.
    const c = countLeaveDays({ start: "2026-11-26", end: "2026-12-01" });
    expect(c.days).toBe(4);
    expect(c.calendar_days).toBe(6);
    expect(c.weekend_days).toEqual(["2026-11-28", "2026-11-29"]);
    expect(c.by_year).toEqual({ "2026": 4 });
  });

  it("counts a weekend-only range as 0", () => {
    expect(countLeaveDays({ start: "2026-11-28", end: "2026-11-29" }).days).toBe(0);
    expect(countLeaveDays({ start: "2026-11-28", end: "2026-11-28", startPart: "am", endPart: "am" }).days).toBe(0);
  });
});

describe("countLeaveDays: half days", () => {
  it("counts a one-day morning or afternoon as 0.5", () => {
    expect(countLeaveDays({ start: "2026-11-26", end: "2026-11-26", startPart: "am", endPart: "am" }).days).toBe(0.5);
    expect(countLeaveDays({ start: "2026-11-26", end: "2026-11-26", startPart: "pm", endPart: "pm" }).days).toBe(0.5);
    expect(countLeaveDays({ start: "2026-11-26", end: "2026-11-26" }).days).toBe(1);
  });

  it("counts a pm start and an am end as halves", () => {
    // Thu pm, Fri, Mon, Tue am = 0.5 + 1 + 1 + 0.5
    expect(countLeaveDays({ start: "2026-11-26", end: "2026-12-01", startPart: "pm", endPart: "am" }).days).toBe(3);
    expect(countLeaveDays({ start: "2026-11-26", end: "2026-12-01", startPart: "pm" }).days).toBe(3.5);
  });

  it("does not halve a weekend or holiday end", () => {
    // Ends on a Saturday morning: the Saturday never counted.
    expect(countLeaveDays({ start: "2026-11-26", end: "2026-11-28", endPart: "am" }).days).toBe(2);
  });

  it("refuses the part combinations 421 refuses", () => {
    expect(partsFit("2026-11-26", "2026-11-27", "am", "full")).toBe(false);
    expect(partsFit("2026-11-26", "2026-11-27", "full", "pm")).toBe(false);
    expect(partsFit("2026-11-26", "2026-11-26", "am", "pm")).toBe(false);
    expect(() => countLeaveDays({ start: "2026-11-26", end: "2026-11-27", startPart: "am" })).toThrow(RangeError);
    expect(() => countLeaveDays({ start: "2026-11-27", end: "2026-11-26" })).toThrow(RangeError);
    expect(() => countLeaveDays({ start: "2026-02-30", end: "2026-03-01" })).toThrow(RangeError);
    expect(() => countLeaveDays({ start: "2026-01-01", end: "2028-01-05" })).toThrow(RangeError);
  });
});

describe("countLeaveDays: public holidays", () => {
  it("does not count an SA public holiday inside the range", () => {
    // Thu 10 – Fri 18 Dec 2026: 7 weekdays, Wed 16 Dec is the Day of Reconciliation.
    const c = countLeaveDays({ start: "2026-12-10", end: "2026-12-18" });
    expect(c.days).toBe(6);
    expect(c.calendar_days).toBe(9);
    expect(c.holidays).toEqual([{ day: "2026-12-16", name: "Day of Reconciliation" }]);
  });

  it("knows Easter and Sunday-observed holidays", () => {
    expect(saHolidayName("2027-03-26")).toBe("Good Friday");
    expect(saHolidayName("2027-03-29")).toBe("Family Day");
    expect(saHolidayName("2027-03-22")).toBe("Human Rights Day (observed)"); // 21 Mar 2027 is a Sunday
    expect(saHolidayName("2027-03-23")).toBeNull();
    // Mon 22 – Mon 29 Mar 2027: 6 weekdays, minus the observed Monday, Good Friday and Family Day.
    expect(countLeaveDays({ start: "2027-03-22", end: "2027-03-29" }).days).toBe(3);
  });

  it("skips declared one-off holidays too", () => {
    const declared = [{ day: "2026-11-04", name: "Election day" }];
    expect(countLeaveDays({ start: "2026-11-02", end: "2026-11-06" }).days).toBe(5);
    const c = countLeaveDays({ start: "2026-11-02", end: "2026-11-06", declared });
    expect(c.days).toBe(4);
    expect(c.holidays).toEqual(declared);
  });

  it("counts a range of only holidays and weekends as 0", () => {
    expect(countLeaveDays({ start: "2026-12-25", end: "2026-12-27" }).days).toBe(0);
  });
});

describe("countLeaveDays: across the year boundary", () => {
  it("splits the days by calendar year", () => {
    // Mon 28 Dec 2026 – Tue 5 Jan 2027: 28–31 Dec, then 1 Jan (holiday), weekend, 4–5 Jan.
    const c = countLeaveDays({ start: "2026-12-28", end: "2027-01-05" });
    expect(c.by_year).toEqual({ "2026": 4, "2027": 2 });
    expect(c.days).toBe(6);
    expect(c.holidays.map((h) => h.day)).toEqual(["2027-01-01"]);
  });

  it("keeps half days in their own year", () => {
    const c = countLeaveDays({ start: "2026-12-28", end: "2027-01-05", startPart: "pm", endPart: "am" });
    expect(c.by_year).toEqual({ "2026": 3.5, "2027": 1.5 });
    expect(daysInYear(c.by_year, 2026)).toBe(3.5);
    expect(daysInYear(c.by_year, 2027)).toBe(1.5);
    expect(daysInYear(c.by_year, 2028)).toBe(0);
  });

  it("leaves out a year with no counted days, like 421", () => {
    // Thu 31 Dec 2026 – Fri 1 Jan 2027: 1 Jan is a holiday.
    expect(countLeaveDays({ start: "2026-12-31", end: "2027-01-01" }).by_year).toEqual({ "2026": 1 });
  });
});
