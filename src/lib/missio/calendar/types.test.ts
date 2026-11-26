import { describe, expect, it } from "vitest";
import { inputToRow, parseEventInput, rowToEvent } from "./types";

const base = { title: "Camp", category: "events", campus: "all", startsOn: "2027-04-02", endsOn: "2027-04-05" };

describe("parseEventInput", () => {
  it("accepts an all-day multi-day event and trims text", () => {
    const parsed = parseEventInput({ ...base, title: "  Camp  ", location: " ", description: "Bring a tent" });
    expect(parsed).toEqual({
      ok: true,
      value: {
        title: "Camp",
        description: "Bring a tent",
        location: null,
        category: "events",
        campus: "all",
        startsOn: "2027-04-02",
        endsOn: "2027-04-05",
        startTime: null,
        endTime: null,
        repeat: null,
        skipDates: [],
      },
    });
  });

  it("needs a title and one of the four categories (holidays aren't editable)", () => {
    const parsed = parseEventInput({ ...base, title: "", category: "national" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(Object.keys(parsed.fieldErrors).sort()).toEqual(["category", "title"]);
  });

  it("rejects an end before the start, bad dates and half a time", () => {
    expect(parseEventInput({ ...base, endsOn: "2027-04-01" }).ok).toBe(false);
    expect(parseEventInput({ ...base, startsOn: "2027-02-30" }).ok).toBe(false);
    expect(parseEventInput({ ...base, startTime: "09:00" }).ok).toBe(false);
    expect(parseEventInput({ ...base, endsOn: base.startsOn, startTime: "11:00", endTime: "09:00" }).ok).toBe(false);
    expect(parseEventInput({ ...base, startTime: "18:00", endTime: "09:00" }).ok).toBe(true);
  });

  it("checks a weekly repeat", () => {
    const sunday = { ...base, endsOn: base.startsOn, category: "sundays", startTime: "09:00", endTime: "11:00" };
    expect(parseEventInput({ ...sunday, repeat: { every: 1 } }).ok).toBe(true);
    expect(parseEventInput({ ...sunday, repeat: { every: 0 } }).ok).toBe(false);
    expect(parseEventInput({ ...sunday, repeat: { every: 1, until: "2027-12-31", count: 4 } }).ok).toBe(false);
    expect(parseEventInput({ ...sunday, repeat: { every: 1, until: "2027-01-01" } }).ok).toBe(false);
    // A four-day camp can't repeat every week… but can every two.
    expect(parseEventInput({ ...base, endsOn: "2027-04-09", repeat: { every: 1 } }).ok).toBe(false);
    expect(parseEventInput({ ...base, repeat: { every: 2 } }).ok).toBe(true);
    expect(parseEventInput({ ...sunday, skipDates: ["2027-04-09"] }).ok).toBe(false);
  });

  it("round-trips through a database row", () => {
    const parsed = parseEventInput({
      ...base,
      endsOn: base.startsOn,
      startTime: "09:00",
      endTime: "11:00",
      campus: "jhb",
      repeat: { every: 1, count: 6 },
      skipDates: ["2027-04-16", "2027-04-09", "2027-04-09"],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const row = { id: "e1", ...inputToRow(parsed.value), start_time: "09:00:00", end_time: "11:00:00" };
    expect(row.skip_dates).toEqual(["2027-04-09", "2027-04-16"]);
    const back = rowToEvent(row);
    expect(back).toMatchObject({ startTime: "09:00", endTime: "11:00", campus: "jhb", repeat: { every: 1, until: null, count: 6 } });
  });
});
