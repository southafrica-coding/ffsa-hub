import { practiceWeekSchema, type PracticeWeek } from "../api";
import { toMin } from "../logic";
import {
  blockedReason,
  bookingNames,
  canCancel,
  isClosedDay,
  isOpenYet,
  longerOption,
  myPracticeBookings,
  opensLabel,
  practiceRows,
  preferredStation,
  rowState,
  stationName,
} from "../practice-logic";
import { strings } from "../strings";
import { BAND_BOOKING, ME_ID, PRACTICE_SETTINGS, practiceWeek } from "../__fixtures__/fixtures";

const week = (over: Parameters<typeof practiceWeek>[0] = {}): PracticeWeek => practiceWeekSchema.parse(practiceWeek(over));

describe("practice rows and days", () => {
  const w = week();

  it("splits 16:00–17:30 into three half-hour rows", () => {
    expect(practiceRows(w.settings).map((r) => r.start)).toEqual([960, 990, 1020]);
  });

  it("Tuesday (ministry night) and weekends are closed", () => {
    expect(isClosedDay(w.settings, "2026-11-03")).toBe(true);
    expect(isClosedDay(w.settings, "2026-11-04")).toBe(false);
    expect(isClosedDay(w.settings, "2026-11-07")).toBe(true);
  });

  it("knows who is in a row, and what's still open", () => {
    const r = rowState(w.bookings, w.stations, "2026-11-04", 960, 990);
    expect(r.byStation.has("st-drums")).toBe(true);
    expect(r.open).toBe(2);
    expect(r.people).toBe(1);
    // A 60-minute booking covers both of its rows.
    expect(rowState(w.bookings, w.stations, "2026-11-05", 1020, 1050).byStation.has("st-keys")).toBe(true);
  });

  it("a band takes the whole room", () => {
    const withBand = week({ bookings: [BAND_BOOKING] });
    const r = rowState(withBand.bookings, withBand.stations, "2026-11-06", 990, 1020);
    expect(r.band?.band_name).toBe("The Sends");
    expect(r.open).toBe(0);
  });

  it("names a group by its first singer", () => {
    const b = { ...week().bookings[0], people: [...week().bookings[0].people, { user_id: "u5", station_id: "st-vocals", first_name: "Sample Person 258", full_name: "Sample Person 258 M" }] };
    expect(bookingNames(b)).toBe("Sample Person 199 +1");
  });
});

describe("who can book, and when", () => {
  it("the web's order: membership, then time gone, then opening", () => {
    expect(blockedReason(week({ me: { canBook: false, isStaff: false, defaultStationId: null } }), "2026-11-04", 990)).toBe(strings.practice.cantBook);
    expect(blockedReason(week({ now: "2026-11-04T16:45" }), "2026-11-04", 990)).toBe(strings.practice.gone);
    expect(blockedReason(week({ now: "2026-10-31T10:00" }), "2026-11-04", 990)).toBe(
      strings.practice.notOpenYet("Sun 1 Nov at 00:00"),
    );
    expect(blockedReason(week(), "2026-11-04", 990)).toBeNull();
  });

  it("opens Sunday 00:00 SAST", () => {
    expect(isOpenYet(week({ now: "2026-10-31T23:59" }))).toBe(false);
    expect(isOpenYet(week({ now: "2026-11-01T00:00" }))).toBe(true);
    expect(opensLabel("2026-11-08T00:00")).toBe("Sun 8 Nov at 00:00");
  });
});

describe("booking a station", () => {
  const w = week();
  const keys = w.stations[0];

  it("pre-selects your instrument when it's free, else the first free station", () => {
    const free = rowState(w.bookings, w.stations, "2026-11-04", 960, 990);
    expect(preferredStation(w, free)).toBe("st-keys");
    const keysTaken = rowState(w.bookings, w.stations, "2026-11-05", 990, 1020);
    expect(preferredStation(w, keysTaken)).toBe("st-drums");
  });

  it("offers 60 minutes only when the next row is free for that station", () => {
    expect(longerOption(w, "2026-11-04", 960, keys).ok).toBe(true);
    const blocked = longerOption(w, "2026-11-05", 960, keys);
    expect(blocked).toEqual({ ok: false, note: strings.practice.takenNext("Keys", "16:30") });
    expect(longerOption(w, "2026-11-04", 1020, keys)).toEqual({ ok: false, note: strings.practice.endsAt("17:30") });
  });

  it("no 60-minute option when the room's maximum is 30", () => {
    const short = week({ settings: { ...PRACTICE_SETTINGS, max_minutes: 30 } });
    expect(longerOption(short, "2026-11-04", 960, keys).ok).toBe(false);
  });
});

describe("my practice", () => {
  const w = week();

  it("lists only my bookings, soonest first", () => {
    expect(myPracticeBookings(w, ME_ID).map((b) => b.id)).toEqual(["pb2"]);
    expect(stationName(w, w.bookings[1])).toBe("Keys");
    expect(toMin(w.bookings[1].end_time)).toBe(1050);
  });

  it("I may cancel my own; staff may cancel anyone's", () => {
    expect(canCancel(w.bookings[1], ME_ID, w)).toBe(true);
    expect(canCancel(w.bookings[0], ME_ID, w)).toBe(false);
    expect(canCancel(w.bookings[0], ME_ID, week({ me: { canBook: true, isStaff: true, defaultStationId: null } }))).toBe(true);
  });
});
