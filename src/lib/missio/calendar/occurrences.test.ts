import { describe, expect, it } from "vitest";
import {
  ALL_FILTERS,
  calendarQueryString,
  expandAll,
  expandEvent,
  isLongSpan,
  matchesFilters,
  parseCalendarQuery,
} from "./occurrences";
import type { CalendarEvent } from "./types";

const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: "e1",
  title: "Sunday gathering",
  description: null,
  location: null,
  category: "sundays",
  campus: "all",
  startsOn: "2026-11-01",
  endsOn: "2026-11-01",
  startTime: "09:00",
  endTime: "11:00",
  repeat: null,
  skipDates: [],
  source: "missio",
  ...over,
});

const starts = (list: { startsOn: string }[]) => list.map((o) => o.startsOn);

describe("expandEvent", () => {
  it("shows a one-off only when it touches the range", () => {
    expect(starts(expandEvent(event({}), "2026-11-01", "2026-11-30"))).toEqual(["2026-11-01"]);
    expect(expandEvent(event({}), "2026-12-01", "2026-12-31")).toEqual([]);
  });

  it("keeps a multi-day event that started before the range", () => {
    const camp = event({ startsOn: "2026-06-29", endsOn: "2026-07-03", startTime: null, endTime: null });
    expect(expandEvent(camp, "2026-07-01", "2026-07-31").map((o) => [o.startsOn, o.endsOn])).toEqual([["2026-06-29", "2026-07-03"]]);
  });

  it("repeats every week on the same weekday", () => {
    const sundays = event({ repeat: { every: 1, until: null, count: null } });
    expect(starts(expandEvent(sundays, "2026-11-01", "2026-11-30"))).toEqual([
      "2026-11-01",
      "2026-11-08",
      "2026-11-15",
      "2026-11-22",
      "2026-11-29",
    ]);
  });

  it("jumps straight to a far-off range", () => {
    const sundays = event({ startsOn: "2026-01-04", endsOn: "2026-01-04", repeat: { every: 1, until: null, count: null } });
    const out = expandEvent(sundays, "2028-03-01", "2028-03-31");
    expect(starts(out)).toEqual(["2028-03-05", "2028-03-12", "2028-03-19", "2028-03-26"]);
    expect(out[0]!.index).toBe(113);
  });

  it("honours the interval, the last date, the count and skipped dates", () => {
    const fortnightly = event({ repeat: { every: 2, until: "2026-12-13", count: null } });
    expect(starts(expandEvent(fortnightly, "2026-11-01", "2026-12-31"))).toEqual(["2026-11-01", "2026-11-15", "2026-11-29", "2026-12-13"]);
    const three = event({ repeat: { every: 1, until: null, count: 3 } });
    expect(starts(expandEvent(three, "2026-11-01", "2026-12-31"))).toEqual(["2026-11-01", "2026-11-08", "2026-11-15"]);
    const skipped = event({ repeat: { every: 1, until: "2026-11-22", count: null }, skipDates: ["2026-11-08"] });
    expect(starts(expandEvent(skipped, "2026-11-01", "2026-11-30"))).toEqual(["2026-11-01", "2026-11-15", "2026-11-22"]);
  });

  it("counts skipped dates toward COUNT, as RRULE + EXDATE does", () => {
    const three = event({ repeat: { every: 1, until: null, count: 3 }, skipDates: ["2026-11-08"] });
    expect(starts(expandEvent(three, "2026-11-01", "2026-12-31"))).toEqual(["2026-11-01", "2026-11-15"]);
  });

  it("sorts all-day before timed, then by time", () => {
    const list = expandAll(
      [event({ id: "b", startTime: "18:00", endTime: "19:00" }), event({ id: "a", startTime: null, endTime: null }), event({ id: "c" })],
      "2026-11-01",
      "2026-11-01"
    );
    expect(list.map((o) => o.event.id)).toEqual(["a", "c", "b"]);
  });

  it("treats a week or more as a long span", () => {
    expect(isLongSpan(expandEvent(event({ startsOn: "2026-01-14", endsOn: "2026-03-27" }), "2026-01-01", "2026-12-31")[0]!)).toBe(true);
    expect(isLongSpan(expandEvent(event({ endsOn: "2026-11-03" }), "2026-01-01", "2026-12-31")[0]!)).toBe(false);
  });
});

describe("filters", () => {
  it("filters by category", () => {
    expect(matchesFilters(event({}), { ...ALL_FILTERS, categories: ["events"] })).toBe(false);
    expect(matchesFilters(event({}), { ...ALL_FILTERS, categories: ["sundays"] })).toBe(true);
  });

  it("shows a campus its own events and the all-campus ones", () => {
    const potch = { ...ALL_FILTERS, campus: "potch" as const };
    expect(matchesFilters(event({ campus: "potch" }), potch)).toBe(true);
    expect(matchesFilters(event({ campus: "all" }), potch)).toBe(true);
    expect(matchesFilters(event({ campus: "jhb" }), potch)).toBe(false);
    expect(matchesFilters(event({ campus: "jhb" }), ALL_FILTERS)).toBe(true);
  });

  it("round-trips through the address bar and ignores junk", () => {
    const today = "2026-11-23";
    const query = { view: "month" as const, year: 2027, month: 3, categories: ["events" as const, "sundays" as const], campus: "jhb" as const };
    const text = calendarQueryString(query, today);
    expect(text).toBe("?view=month&y=2027&m=3&cats=sundays%2Cevents&campus=jhb");
    expect(parseCalendarQuery(text, today)).toEqual({ ...query, categories: ["sundays", "events"] });
    expect(calendarQueryString(parseCalendarQuery("", today), today)).toBe("");
    expect(parseCalendarQuery("?view=nope&y=99999&m=13&campus=cpt&cats=", today)).toEqual({
      view: "year",
      year: 2026,
      month: 11,
      categories: [],
      campus: "all",
    });
  });
});
