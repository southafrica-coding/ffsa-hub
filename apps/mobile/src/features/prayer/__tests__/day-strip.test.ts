// The Mon–Fri day strip (design-spec §7.4): which week "This week" means,
// which day opens, the label, the five days and each day's one marker word.
// Nov 2026: Sun 1, Mon 2 … Sat 7; Mon 16 … Fri 20, Sat 21, Sun 22.
import { blockoutSchema, prayerSetSchema, seatTypeSchema, type PrayerSet } from "../api";
import { currentWeekAnchor, dayMarker, defaultDay, stripDays, stripSummary, stripWeek, weekdayRangeLabel } from "../day-strip";
import { weekDays, weekStart } from "../logic";
import { strings } from "../strings";
import { BLOCKOUT, ME_ID, SEAT_TYPES, UNLED, prayerSet, person, slot } from "../__fixtures__/fixtures";

const parse = (raw: unknown): PrayerSet => prayerSetSchema.parse(raw);
const seatTypes = SEAT_TYPES.map((s) => seatTypeSchema.parse(s));

describe("which week is 'This week'", () => {
  it("Monday to Friday: the week you're in", () => {
    for (const today of ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]) {
      expect(currentWeekAnchor(today)).toBe("2026-11-15");
    }
  });

  it("Saturday and Sunday: the coming week", () => {
    expect(currentWeekAnchor("2026-11-21")).toBe("2026-11-22");
    expect(currentWeekAnchor("2026-11-22")).toBe("2026-11-22");
    expect(stripDays(currentWeekAnchor("2026-11-21"))[0]).toBe("2026-11-23");
    expect(stripDays(currentWeekAnchor("2026-11-22"))[0]).toBe("2026-11-23");
  });

  it("is always a Sunday key, so the API range and the saved-week cache don't move", () => {
    for (const today of ["2026-11-16", "2026-11-20", "2026-11-21", "2026-11-22", "2026-12-31", "2027-01-02"]) {
      const anchor = currentWeekAnchor(today);
      expect(weekStart(anchor)).toBe(anchor);
      expect(weekDays(anchor)[0]).toBe(anchor);
    }
  });

  it("crosses a year end", () => {
    // Sat 2 Jan 2027 → the week of Mon 4 Jan.
    expect(currentWeekAnchor("2027-01-02")).toBe("2027-01-03");
    // Thu 31 Dec 2026 → the week of Mon 28 Dec.
    expect(stripDays(currentWeekAnchor("2026-12-31"))).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01"]);
  });
});

describe("the five days", () => {
  it("are Monday to Friday of the Sunday-keyed week, whatever day anchors it", () => {
    const days = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];
    expect(stripDays("2026-11-15")).toEqual(days);
    expect(stripDays("2026-11-18")).toEqual(days);
    expect(stripDays("2026-11-21")).toEqual(days);
  });
});

describe("the day a week opens on", () => {
  it("each weekday: today", () => {
    for (const today of ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]) {
      expect(defaultDay(currentWeekAnchor(today), today)).toBe(today);
    }
  });

  it("Saturday and Sunday: Monday of the coming week", () => {
    expect(defaultDay(currentWeekAnchor("2026-11-21"), "2026-11-21")).toBe("2026-11-23");
    expect(defaultDay(currentWeekAnchor("2026-11-22"), "2026-11-22")).toBe("2026-11-23");
  });

  it("another week: its Monday", () => {
    expect(defaultDay("2026-11-22", "2026-11-18")).toBe("2026-11-23");
    expect(defaultDay("2026-11-08", "2026-11-18")).toBe("2026-11-09");
  });
});

describe("the week label", () => {
  it("reads Monday to Friday", () => {
    expect(weekdayRangeLabel("2026-11-15")).toBe("16–20 Nov 2026");
    expect(weekdayRangeLabel("2026-11-18")).toBe("16–20 Nov 2026");
  });

  it("spans months and years", () => {
    expect(weekdayRangeLabel("2026-11-29")).toBe("30 Nov – 4 Dec 2026");
    expect(weekdayRangeLabel("2026-12-27")).toBe("28 Dec 2026 – 1 Jan 2027");
  });

  it("drops the year for the current week: '16–20 Nov · This week'", () => {
    expect(strings.week.rangeThisWeek(weekdayRangeLabel("2026-11-15", { year: false }))).toBe("16–20 Nov · This week");
    expect(weekdayRangeLabel("2026-11-29", { year: false })).toBe("30 Nov – 4 Dec");
    expect(weekdayRangeLabel("2026-12-27", { year: false })).toBe("28 Dec – 1 Jan");
  });
});

describe("the week's days, sets and markers", () => {
  const mine = parse(prayerSet()); // Tue 3 Nov: led, I'm on keys
  const unled = parse(UNLED); // Mon 2 Nov: nobody leads, I'm invited
  const saturday = parse(prayerSet({ id: "sat", set_date: "2026-11-07" }));
  const cancelled = parse(prayerSet({ id: "gone", status: "cancelled" }));
  const invited = parse(
    prayerSet({
      id: "inv",
      set_date: "2026-11-04",
      slots: [
        slot({ id: "a", seat: "prayer_lead", status: "filled", user: person("u2", "Sample Person 199") }),
        slot({ id: "b", seat: "keys", status: "invited", user: person(ME_ID, "Sample") }),
      ],
    }),
  );
  const owned = parse(
    prayerSet({
      id: "own",
      set_date: "2026-11-06",
      owner_id: ME_ID,
      slots: [slot({ id: "c", seat: "prayer_lead", status: "filled", user: person("u2", "Sample Person 199") })],
    }),
  );
  const blockouts = [blockoutSchema.parse(BLOCKOUT)]; // Thu 5 Nov
  const days = stripWeek("2026-11-01", [mine, unled, saturday, cancelled, invited, owned], blockouts);
  const marker = (date: string, userId: string | null = ME_ID) => dayMarker(days.find((d) => d.date === date)!, seatTypes, userId);

  it("shows five days, never a weekend, even with a set on one", () => {
    expect(days.map((d) => d.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
    expect(days[1].sets.map((s) => s.id)).toEqual(["s1"]);
  });

  it("totals ignore the weekend and cancelled sets", () => {
    expect(stripSummary(days).sets).toBe(4);
    expect(stripSummary(stripWeek("2026-11-08", [mine], [])).sets).toBe(0);
  });

  it("one marker word per day", () => {
    expect(marker("2026-11-02")).toBe("noLead");
    expect(marker("2026-11-03")).toBe("you");
    expect(marker("2026-11-04")).toBe("invited");
    expect(marker("2026-11-05")).toBe("blocked");
    // A set I set up but am not on carries "Your set" on its row, not a strip marker.
    expect(marker("2026-11-06")).toBeNull();
  });

  it("priority: Blocked › No lead › Invited › You", () => {
    const one = (sets: PrayerSet[], blocked = false) =>
      dayMarker({ date: "2026-11-02", sets, blockouts: blocked ? blockouts : [] }, seatTypes, ME_ID);
    const on = { ...mine, set_date: "2026-11-02" };
    const inv = { ...invited, set_date: "2026-11-02" };
    expect(one([on, inv, unled], true)).toBe("blocked");
    expect(one([on, inv, unled])).toBe("noLead");
    expect(one([on, inv])).toBe("invited");
    expect(one([on])).toBe("you");
    expect(one([])).toBeNull();
  });

  it("signed out of a relation: only the room's own markers", () => {
    expect(marker("2026-11-03", null)).toBeNull();
    expect(marker("2026-11-02", null)).toBe("noLead");
  });

  it("every marker has a word, and the tab says its date, 'today' and the word", () => {
    expect(strings.week.markers).toEqual({ blocked: "Blocked", noLead: "No lead", invited: "Invited", you: "You" });
    expect(strings.week.dayTab("Wednesday 18 November", true, "No lead")).toBe("Wednesday 18 November, today, No lead");
    expect(strings.week.dayTab("Monday 16 November", false, null)).toBe("Monday 16 November");
  });
});
