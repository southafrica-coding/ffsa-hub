import { describe, it, expect } from "vitest";
import { centsToInput, goLiveBlockers, listingWarnings, parseRands, parseSpecs, specsToText } from "./listing";

const base = {
  can_leave_building: true,
  price_day_cents: 12_000,
  price_weekend_cents: 20_000,
  price_week_cents: 45_000,
  store_category_id: "cat",
};

describe("going live", () => {
  it("is allowed exactly when the database CHECK would pass", () => {
    expect(goLiveBlockers(base)).toEqual([]);
    expect(goLiveBlockers({ ...base, can_leave_building: false })).toHaveLength(1);
    expect(goLiveBlockers({ ...base, price_day_cents: null })).toHaveLength(1);
    expect(goLiveBlockers({ ...base, can_leave_building: false, price_day_cents: null })).toHaveLength(2);
    // A weekend or week price alone isn't enough.
    expect(goLiveBlockers({ ...base, price_day_cents: null, price_weekend_cents: 1 })).toHaveLength(1);
  });

  it("warns without blocking", () => {
    expect(listingWarnings(base, { photos: 2, bookable: 4 })).toEqual([]);
    expect(listingWarnings({ ...base, store_category_id: null }, { photos: 0, bookable: 0 })).toHaveLength(3);
    expect(listingWarnings({ ...base, price_weekend_cents: 60_000 }, { photos: 1, bookable: 1 })).toHaveLength(1);
  });
});

describe("form values", () => {
  it("reads rands", () => {
    expect(parseRands("120")).toBe(12_000);
    expect(parseRands("R 1 250.50")).toBe(125_050);
    expect(parseRands("")).toBeNull();
    expect(parseRands("12.345")).toBeNaN();
    expect(parseRands("-5")).toBeNaN();
    expect(centsToInput(125_050)).toBe("1250.50");
    expect(centsToInput(12_000)).toBe("120");
  });

  it("round-trips specs", () => {
    const specs = parseSpecs("Type: Dynamic, cardioid\nRange: 50 Hz – 15 kHz\nnot a spec\n");
    expect(specs).toEqual({ Type: "Dynamic, cardioid", Range: "50 Hz – 15 kHz" });
    expect(specsToText(specs)).toBe("Type: Dynamic, cardioid\nRange: 50 Hz – 15 kHz");
  });
});
