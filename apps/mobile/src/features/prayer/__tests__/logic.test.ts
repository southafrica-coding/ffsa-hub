import { ApiError } from "@/lib/api";
import { makeMe } from "../../../../test/fixtures";

import { prayerSetSchema, type PrayerSet } from "../api";
import {
  bandFor,
  blockoutWhen,
  canManageSet,
  dayLabel,
  durationLabel,
  friendlyError,
  friendlyServerMessage,
  groupWeek,
  leadNames,
  leadSeatIds,
  lineup,
  myRelation,
  needsALead,
  prayerAccess,
  sastNow,
  sastToday,
  savedAtLabel,
  seatCounts,
  seatLabel,
  setSentence,
  spokenDate,
  spokenTimeRange,
  timeRange,
  weekDays,
  weekRangeLabel,
  weekStart,
  weekSummary,
} from "../logic";
import { ServerMessageError } from "../server-message";
import { strings } from "../strings";
import { BANDS, BLOCKOUT, ME_ID, SEAT_TYPES, UNLED, prayerSet } from "../__fixtures__/fixtures";
import { blockoutSchema, bandSchema, seatTypeSchema } from "../api";

const parse = (raw: unknown): PrayerSet => prayerSetSchema.parse(raw);
const seatTypes = SEAT_TYPES.map((s) => seatTypeSchema.parse(s));
const bands = BANDS.map((b) => bandSchema.parse(b));

describe("SAST clock (fixed UTC+2, no daylight saving)", () => {
  it("is two hours ahead of UTC whatever the phone's zone", () => {
    expect(sastNow(new Date("2026-11-03T06:00:00Z"))).toBe("2026-11-03T08:00");
  });

  it("rolls the date over at 22:00 UTC", () => {
    expect(sastToday(new Date("2026-11-03T21:59:00Z"))).toBe("2026-11-03");
    expect(sastToday(new Date("2026-11-03T22:00:00Z"))).toBe("2026-11-04");
  });

  it("has no DST jump: the same offset in January and July", () => {
    expect(sastNow(new Date("2026-01-15T10:00:00Z"))).toBe("2026-01-15T12:00");
    expect(sastNow(new Date("2026-07-15T10:00:00Z"))).toBe("2026-07-15T12:00");
  });
});

describe("week maths (Sunday-start, the room's convention)", () => {
  it("finds the Sunday for any day of the week", () => {
    expect(weekStart("2026-11-01")).toBe("2026-11-01"); // Sunday
    expect(weekStart("2026-11-03")).toBe("2026-11-01"); // Tuesday
    expect(weekStart("2026-11-07")).toBe("2026-11-01"); // Saturday
  });

  it("lists Sun→Sat across a month and a year boundary", () => {
    expect(weekDays("2026-12-31")).toEqual([
      "2026-12-27",
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });

  it("labels the week like the web", () => {
    expect(weekRangeLabel("2026-11-03")).toBe("1–7 Nov 2026");
    expect(weekRangeLabel("2026-12-01")).toBe("29 Nov – 5 Dec 2026");
  });

  it("formats days for the eye and for the ear", () => {
    expect(dayLabel("2026-11-03")).toBe("Tue 3 Nov");
    expect(spokenDate("2026-11-03")).toBe("Tuesday 3 November");
  });
});

describe("times", () => {
  it("shows 24-hour ranges and durations as the web does", () => {
    expect(timeRange("19:00", "21:00")).toBe("19:00–21:00");
    expect(durationLabel("08:00", "09:30")).toBe("1H 30MIN");
    expect(durationLabel("08:00", "08:45")).toBe("45MIN");
    expect(durationLabel("19:00", "21:00")).toBe("2H");
  });

  it("speaks ranges naturally", () => {
    expect(spokenTimeRange("19:00", "21:00")).toBe("7 to 9 pm");
    expect(spokenTimeRange("11:30", "13:00")).toBe("11:30 am to 1 pm");
    expect(spokenTimeRange("06:00", "08:00")).toBe("6 to 8 am");
    expect(spokenTimeRange("22:00", "24:00")).toBe("10 pm to midnight");
    expect(spokenTimeRange("12:00", "14:00")).toBe("noon to 2 pm");
  });
});

describe("the wall's rules", () => {
  const live = parse(prayerSet());
  const unled = parse(UNLED);

  it("parses Postgres times down to HH:MM and tolerates missing slots", () => {
    expect(live.start_time).toBe("19:00");
    expect(parse({ ...prayerSet(), slots: undefined }).slots).toEqual([]);
  });

  it("a set is live once a lead seat is filled", () => {
    expect(needsALead(live, seatTypes)).toBe(false);
    expect(needsALead(unled, seatTypes)).toBe(true);
  });

  it("falls back to the two legacy lead roles before the seat list exists", () => {
    expect([...leadSeatIds([])]).toEqual(["prayer_leader", "worship_leader"]);
    const legacy = parse({ ...prayerSet(), slots: [{ id: "x", role: "worship_leader", seat_type_id: null, status: "filled", filled: { id: "u5", first_name: "Ayanda" } }] });
    expect(needsALead(legacy, [])).toBe(false);
    expect(leadNames(legacy, [])).toBe("Ayanda");
  });

  it("names who leads, by first name", () => {
    expect(leadNames(live, seatTypes)).toBe("Thabo");
    expect(leadNames(unled, seatTypes)).toBeNull();
  });

  it("counts seats: filled are taken, open/declined are open, invited is neither", () => {
    expect(seatCounts(live)).toEqual({ taken: 2, open: 2, total: 4 });
    expect(seatCounts(unled)).toEqual({ taken: 0, open: 1, total: 2 });
  });

  it("puts lead seats first, then the vocabulary's order", () => {
    const l = lineup(live, seatTypes);
    expect(l.leads.map((s) => s.id)).toEqual(["sl1", "sl2"]);
    expect(l.others.map((s) => s.id)).toEqual(["sl3", "sl4"]);
  });

  it("labels seats from the vocabulary, else the legacy names", () => {
    expect(seatLabel({ seat_type_id: "keys", role: "keys" }, seatTypes)).toBe("Keys");
    expect(seatLabel({ role: "worship_leader" }, [])).toBe("Worship Lead");
    expect(seatLabel({ role: "drum_kit" }, [])).toBe("drum kit");
  });

  it("finds the curated band by time overlap (the web's rule)", () => {
    expect(bandFor(unled, bands)).toBe("MORNING");
    expect(bandFor(live, bands)).toBe("NIGHT");
    expect(bandFor({ start_time: "12:00", end_time: "13:00" }, bands)).toBeNull();
  });

  it("knows how I'm connected to a set", () => {
    expect(myRelation(live, ME_ID)).toBe("serving");
    expect(myRelation(unled, ME_ID)).toBe("invited");
    expect(myRelation(live, "u9")).toBe("owner");
    expect(myRelation(live, "u7")).toBeNull();
    expect(myRelation(live, null)).toBeNull();
  });
});

describe("the week as a run of days", () => {
  const sets = [parse(prayerSet()), parse(UNLED), parse(prayerSet({ id: "sat", set_date: "2026-11-07" })), parse(prayerSet({ id: "gone", status: "cancelled" }))];
  const blockouts = [blockoutSchema.parse(BLOCKOUT), blockoutSchema.parse({ ...BLOCKOUT, id: "bo2", block_date: "2026-11-04", end_date: "2026-11-06", start_time: null, end_time: null })];

  it("always shows Mon–Fri, weekends only when something is on, cancelled sets never", () => {
    const days = groupWeek("2026-11-03", sets, blockouts);
    expect(days.map((d) => d.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
    expect(days[1].sets.map((s) => s.id)).toEqual(["s1"]);
  });

  it("spreads a multi-day block-out over every day it covers", () => {
    const days = groupWeek("2026-11-03", sets, blockouts);
    const covered = days.filter((d) => d.blockouts.some((b) => b.id === "bo2")).map((d) => d.date);
    expect(covered).toEqual(["2026-11-04", "2026-11-05", "2026-11-06"]);
    expect(blockoutWhen(blockouts[0])).toBe("10:00–12:00");
    expect(blockoutWhen(blockouts[1])).toBe("all day");
  });

  it("summarises the week for the masthead", () => {
    expect(weekSummary(sets)).toEqual({ sets: 3, open: 5, seats: 10 });
    expect(strings.week.context("1–7 Nov 2026", 0, 0, 0)).toBe("1–7 Nov 2026 · nothing booked");
    expect(strings.week.context("1–7 Nov 2026", 2, 0, 3)).toBe("1–7 Nov 2026 · 2 sets · every seat filled");
  });
});

describe("spoken sentence for a set", () => {
  it("reads as one sentence, as VoiceOver should say it", () => {
    expect(setSentence(parse(prayerSet()), seatTypes, [], ME_ID)).toBe(
      "Tuesday 7 to 9 pm, Night watch, 2 of 4 seats taken, you are on this set",
    );
  });

  it("says the band, a missing lead and an invitation in words", () => {
    expect(setSentence(parse(UNLED), seatTypes, bands, ME_ID)).toBe(
      "Monday 8 to 9:30 am, Morning devo, MORNING band, 0 of 2 seats taken, needs a lead, you're invited to a seat",
    );
  });
});

describe("permission gate (UX only, mirrors the web)", () => {
  it("an ordinary member sees no evaluator tools and isn't staff", () => {
    expect(prayerAccess(makeMe())).toEqual({ isStaff: false, isEvaluator: false, showEvaluatorTools: false });
  });

  it("evaluators (direct or via a role) see the evaluator tools", () => {
    const me = makeMe({ permissions: [{ key: "prayer_room.evaluate", scopeType: null, scopeId: null, source: "role" }] });
    expect(prayerAccess(me)).toEqual({ isStaff: false, isEvaluator: true, showEvaluatorTools: true });
  });

  it("staff: admin roles, prayer_room_admin, or a DIRECT prayer_room.manage", () => {
    expect(prayerAccess(makeMe({ roles: [{ name: "admin", scopeType: null, scopeId: null }] })).isStaff).toBe(true);
    expect(prayerAccess(makeMe({ roles: [{ name: "prayer_room_admin", scopeType: null, scopeId: null }] })).showEvaluatorTools).toBe(true);
    expect(
      prayerAccess(makeMe({ permissions: [{ key: "prayer_room.manage", scopeType: null, scopeId: null, source: "direct" }] })).isStaff,
    ).toBe(true);
    // The web reads user_permissions only, so a role-granted manage is not staff there.
    expect(
      prayerAccess(makeMe({ permissions: [{ key: "prayer_room.manage", scopeType: null, scopeId: null, source: "role" }] })).isStaff,
    ).toBe(false);
  });

  it("nothing while /api/me hasn't loaded", () => {
    expect(prayerAccess(null).showEvaluatorTools).toBe(false);
  });

  it("owners and staff manage a set; everyone else doesn't", () => {
    const set = parse(prayerSet());
    const none = prayerAccess(makeMe());
    expect(canManageSet(set, "u9", none)).toBe(true);
    expect(canManageSet(set, ME_ID, none)).toBe(false);
    expect(canManageSet(set, ME_ID, { ...none, isStaff: true })).toBe(true);
  });
});

describe("friendly errors", () => {
  const server = (status: number, msg: string) => new ServerMessageError(new ApiError("http", "x", status), msg);

  it("keeps sentences the server wrote for people", () => {
    expect(friendlyError(server(409, "You're already serving in another set that overlaps this time."))).toBe(
      "You're already serving in another set that overlaps this time.",
    );
    expect(friendlyError(server(409, "Someone already has that station then."))).toBe("Someone already has that station then.");
  });

  it("translates raw database messages", () => {
    expect(friendlyServerMessage("JSON object requested, multiple (or no) rows returned")).toBe(strings.errors.seatTaken);
    expect(friendlyServerMessage('conflicting key value violates exclusion constraint "no_double_booking"')).toBe(strings.errors.clash);
    expect(friendlyServerMessage('new row violates row-level security policy for table "x"')).toBe(strings.errors.actionFailed);
  });

  it("network and permission errors in plain words", () => {
    expect(friendlyError(new ApiError("network", "Couldn't reach FFSA Hub. Check your connection and try again."))).toMatch(/Couldn't reach/);
    expect(friendlyError(new ApiError("forbidden", "x", 403))).toBe(strings.errors.forbiddenBody);
    expect(friendlyError(new Error("boom"))).toBe(strings.errors.actionFailed);
  });

  it("'saved at' reads in SAST", () => {
    expect(savedAtLabel("2026-11-03T05:10:00.000Z", new Date("2026-11-03T06:00:00Z"))).toBe("today at 07:10");
    expect(savedAtLabel("2026-11-01T05:10:00.000Z", new Date("2026-11-03T06:00:00Z"))).toBe("Sun 1 Nov at 07:10");
  });
});
