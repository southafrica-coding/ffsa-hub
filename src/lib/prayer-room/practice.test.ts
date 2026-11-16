import { describe, expect, it } from "vitest";

import {
  DEFAULT_PRACTICE_SETTINGS as S,
  isClosedDay,
  opensAt,
  practiceDays,
  practiceErrorMessage,
  practiceRows,
  rowState,
  sastNow,
  type PracticeBooking,
  type PracticeStation,
} from "./practice";

const stations: PracticeStation[] = ["drums", "keys", "electric", "cajon", "acoustic", "bass", "vocals"].map(
  (slug, i) => ({
    id: slug,
    slug,
    label: slug,
    short_label: slug.slice(0, 2).toUpperCase(),
    seat_type_id: null,
    sort_order: i,
    max_people: slug === "vocals" ? 4 : 1,
  })
);

const person = (id: string) => ({ user_id: id, station_id: "x", first_name: id, full_name: id });

function booking(over: Partial<PracticeBooking>): PracticeBooking {
  return {
    id: Math.random().toString(36),
    kind: "station",
    practice_date: "2026-10-09",
    start_time: "16:30",
    end_time: "17:00",
    station_id: "drums",
    booked_by: "sample199",
    band_name: null,
    people: [person("sample199")],
    ...over,
  };
}

describe("practice window", () => {
  it("is three 30-minute rows, 16:00 to 17:30", () => {
    expect(practiceRows(S)).toEqual([
      { start: 960, end: 990 },
      { start: 990, end: 1020 },
      { start: 1020, end: 1050 },
    ]);
  });

  it("closes Tuesday and the weekend", () => {
    // Mon 5 – Sun 11 Oct 2026
    const open = ["2026-10-05", "2026-10-07", "2026-10-08", "2026-10-09"];
    const shut = ["2026-10-06", "2026-10-10", "2026-10-11"];
    for (const d of open) expect(isClosedDay(S, d)).toBe(false);
    for (const d of shut) expect(isClosedDay(S, d)).toBe(true);
  });

  it("gives the Mon–Fri of the Sunday-start week", () => {
    expect(practiceDays("2026-10-04")).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(practiceDays("2026-10-10")).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
  });
});

describe("opening", () => {
  it("opens the Sunday that begins the week, at 00:00", () => {
    expect(opensAt(S, "2026-10-07")).toBe("2026-10-04T00:00");
    expect(opensAt(S, "2026-10-05")).toBe("2026-10-04T00:00");
  });

  it("can open a day earlier", () => {
    expect(opensAt({ ...S, opens_weekday: 6, opens_time: "18:00" }, "2026-10-07")).toBe("2026-10-03T18:00");
  });

  it("reads the SAST clock, not the server's UTC one", () => {
    // 23:30 UTC Saturday is already 01:30 Sunday in Johannesburg.
    expect(sastNow(new Date("2026-10-03T23:30:00Z"))).toBe("2026-10-04T01:30");
  });
});

describe("rowState", () => {
  it("counts a 60-minute booking in both rows it covers", () => {
    const b = [booking({ end_time: "17:30" })];
    expect(rowState(b, stations, "2026-10-09", 990, 1020).byStation.has("drums")).toBe(true);
    expect(rowState(b, stations, "2026-10-09", 1020, 1050).byStation.has("drums")).toBe(true);
    expect(rowState(b, stations, "2026-10-09", 960, 990).byStation.size).toBe(0);
  });

  it("counts each singer in a vocal group", () => {
    const b = [
      booking({}),
      booking({ station_id: "vocals", booked_by: "sample145", people: ["sample145", "sample59", "sample258"].map(person) }),
    ];
    const r = rowState(b, stations, "2026-10-09", 990, 1020);
    expect(r.people).toBe(4);
    expect(r.open).toBe(5);
  });

  it("leaves nothing open under a band", () => {
    const b = [booking({ kind: "band", station_id: null, band_name: "Thursday night set", start_time: "16:00", end_time: "16:30" })];
    const r = rowState(b, stations, "2026-10-09", 960, 990);
    expect(r.band?.band_name).toBe("Thursday night set");
    expect(r.open).toBe(0);
  });
});

describe("practiceErrorMessage", () => {
  const clash = (name: string) => ({ code: "23P01", message: `conflicting key value violates exclusion constraint "${name}"` });

  it("translates the clash constraints", () => {
    expect(practiceErrorMessage(clash("practice_station_no_overlap"))).toMatch(/already has that station/);
    expect(practiceErrorMessage(clash("practice_band_vs_station"), "band")).toMatch(/only an admin can move people/);
    expect(practiceErrorMessage(clash("practice_band_vs_station"), "station")).toMatch(/band has the whole room/);
  });

  it("passes the database's own words through", () => {
    expect(practiceErrorMessage({ code: "23514", message: "There is no practice on Tuesdays." })).toBe(
      "There is no practice on Tuesdays."
    );
  });
});
