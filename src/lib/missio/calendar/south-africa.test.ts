import { describe, expect, it } from "vitest";
import { addDays, weekdayMon } from "./dates";
import { nationalEvents, NATIONAL_YEARS, SA_PUBLIC_HOLIDAYS, SA_SCHOOL_TERMS, SA_SPECIAL_SCHOOL_HOLIDAYS } from "./south-africa";

const SUNDAY = 6;
const MONDAY = 0;

describe("public holidays 2026–2028", () => {
  it("has the 12 statutory holidays each year, plus the observed Mondays", () => {
    for (const year of NATIONAL_YEARS) {
      const named = SA_PUBLIC_HOLIDAYS[year].filter((h) => !h.observed);
      expect(named).toHaveLength(12);
      for (const holiday of SA_PUBLIC_HOLIDAYS[year]) expect(holiday.date.startsWith(String(year))).toBe(true);
    }
  });

  it("lists both the Sunday and the observed Monday for every holiday on a Sunday", () => {
    for (const year of NATIONAL_YEARS) {
      const list = SA_PUBLIC_HOLIDAYS[year];
      for (const holiday of list.filter((h) => !h.observed && weekdayMon(h.date) === SUNDAY)) {
        const monday = list.find((h) => h.observed && h.date === addDays(holiday.date, 1));
        expect(monday, `${holiday.name} ${holiday.date}`).toBeDefined();
        expect(monday?.name).toBe(holiday.name);
      }
      for (const observed of list.filter((h) => h.observed)) {
        expect(weekdayMon(observed.date)).toBe(MONDAY);
        expect(list.some((h) => !h.observed && h.date === addDays(observed.date, -1))).toBe(true);
      }
    }
  });

  it("has the observed Mondays the brief names", () => {
    const observed = NATIONAL_YEARS.flatMap((year) => SA_PUBLIC_HOLIDAYS[year].filter((h) => h.observed).map((h) => h.date));
    expect(observed).toEqual(["2026-08-10", "2027-03-22", "2027-12-27", "2028-09-25"]);
  });

  it("puts Good Friday on a Friday and Family Day on the Monday after", () => {
    for (const year of NATIONAL_YEARS) {
      const goodFriday = SA_PUBLIC_HOLIDAYS[year].find((h) => h.name === "Good Friday")!;
      const familyDay = SA_PUBLIC_HOLIDAYS[year].find((h) => h.name === "Family Day")!;
      expect(weekdayMon(goodFriday.date)).toBe(4);
      expect(familyDay.date).toBe(addDays(goodFriday.date, 3));
    }
    expect(SA_PUBLIC_HOLIDAYS[2026].find((h) => h.name === "Good Friday")?.date).toBe("2026-04-03");
    expect(SA_PUBLIC_HOLIDAYS[2027].find((h) => h.name === "Good Friday")?.date).toBe("2027-03-26");
    expect(SA_PUBLIC_HOLIDAYS[2028].find((h) => h.name === "Good Friday")?.date).toBe("2028-04-14");
  });
});

describe("school terms (gazettes)", () => {
  it("matches the gazetted learner dates", () => {
    expect(SA_SCHOOL_TERMS[2026].map((t) => [t.start, t.end])).toEqual([
      ["2026-01-14", "2026-03-27"],
      ["2026-04-08", "2026-06-26"],
      ["2026-07-21", "2026-09-23"],
      ["2026-10-06", "2026-12-09"],
    ]);
    expect(SA_SCHOOL_TERMS[2027].map((t) => [t.start, t.end])).toEqual([
      ["2027-01-13", "2027-03-19"],
      ["2027-04-06", "2027-06-25"],
      ["2027-07-20", "2027-09-22"],
      ["2027-10-05", "2027-12-08"],
    ]);
    expect(SA_SCHOOL_TERMS[2028].map((t) => [t.start, t.end])).toEqual([
      ["2028-01-12", "2028-03-17"],
      ["2028-03-28", "2028-06-14"],
      ["2028-07-11", "2028-09-22"],
      ["2028-10-03", "2028-12-06"],
    ]);
    expect(SA_SPECIAL_SCHOOL_HOLIDAYS).toEqual({ 2026: ["2026-06-15"], 2027: ["2027-04-26"], 2028: ["2028-04-28"] });
  });

  it("turns a year into holidays, terms and the breaks between them, with no overlap or gap", () => {
    const items = nationalEvents(2026);
    const terms = items.filter((e) => e.title.startsWith("School term"));
    const breaks = items.filter((e) => e.title === "School holiday");
    expect(terms).toHaveLength(4);
    expect(breaks.map((b) => [b.startsOn, b.endsOn])).toEqual([
      ["2026-01-01", "2026-01-13"],
      ["2026-03-28", "2026-04-07"],
      ["2026-06-27", "2026-07-20"],
      ["2026-09-24", "2026-10-05"],
      ["2026-12-10", "2026-12-31"],
    ]);
    const school = [...terms, ...breaks].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
    for (let i = 1; i < school.length; i += 1) expect(school[i]!.startsOn).toBe(addDays(school[i - 1]!.endsOn, 1));
    expect(terms[0]!.note).toContain("Educators and admin from 12 Jan");
    expect(terms[3]!.note).toContain("Educators until 11 Dec");
    expect(items.every((e) => e.category === "national" && e.source === "national" && e.campus === "all" && e.startTime === null)).toBe(true);
  });

  it("labels the observed day and keeps ids stable and unique", () => {
    const items = nationalEvents(2027);
    expect(items.find((e) => e.startsOn === "2027-12-27")?.title).toBe("Day of Goodwill (observed)");
    expect(new Set(items.map((e) => e.id)).size).toBe(items.length);
    expect(nationalEvents(2027).map((e) => e.id)).toEqual(items.map((e) => e.id));
  });

  it("returns nothing for a year without gazetted dates", () => {
    expect(nationalEvents(2029)).toEqual([]);
    expect(nationalEvents(2025)).toEqual([]);
  });
});
