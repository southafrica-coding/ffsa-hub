import { describe, it, expect } from "vitest";
import {
  attentionText,
  checkedText,
  hasFault,
  hasNoSerial,
  filterRegister,
  isUnverifiedImport,
  needsAttention,
  NO_LOCATION,
  sastDate,
  shortDate,
  sourceText,
  summariseUnits,
} from "./register";

const unit = (over: Partial<Parameters<typeof summariseUnits>[0][number]> = {}) => ({
  status: "available" as const,
  live_status: "available" as const,
  serial: "S123",
  condition: null as string | null,
  last_checked_on: "2026-04-30" as string | null,
  ...over,
});

describe("register helpers", () => {
  it("treats a blank or Nil serial as missing", () => {
    expect(hasNoSerial({ serial: null })).toBe(true);
    expect(hasNoSerial({ serial: " Nil " })).toBe(true);
    expect(hasNoSerial({ serial: "S1" })).toBe(false);
  });

  it("flags a fault only on bookable units", () => {
    expect(hasFault({ status: "available", condition: "Internal wifi busted" })).toBe(true);
    expect(hasFault({ status: "maintenance", condition: "Fault" })).toBe(false);
    expect(hasFault({ status: "available", condition: "Brand new" })).toBe(false);
  });

  it("summarises the P16-M row the way 45b reads it", () => {
    const units = [
      ...Array.from({ length: 8 }, () => unit()),
      ...Array.from({ length: 5 }, () =>
        unit({ status: "maintenance", live_status: "maintenance", condition: "Broken" })
      ),
    ];
    const s = summariseUnits(units);
    expect(s.total).toBe(13);
    expect(s.bookable).toBe(8);
    expect(attentionText(s)).toBe("5 in maintenance");
    expect(needsAttention(s)).toBe(true);
    expect(checkedText(s)).toBe("30 Apr 2026");
  });

  it("joins every reason and counts never-checked units", () => {
    const s = summariseUnits([
      unit({ serial: "Nil", last_checked_on: null }),
      unit({ condition: "wifi busted", last_checked_on: "2026-09-22" }),
    ]);
    expect(attentionText(s)).toBe("1 fault · 1 no serial");
    expect(checkedText(s)).toBe("22 Sep 2026 · 1 never");
    expect(checkedText(summariseUnits([unit({ last_checked_on: null })]))).toBe("Never");
  });

  it("prints dates as written, with no timezone shift", () => {
    expect(shortDate("2026-04-30")).toBe("30 Apr 2026");
    expect(shortDate("2026-01-01T23:30:00+00:00")).toBe("1 Jan 2026");
  });

  it("puts a late-night timestamp on the SAST day", () => {
    expect(sastDate("2026-04-30T23:30:00Z")).toBe("1 May 2026");
    expect(sastDate("2026-09-22T08:00:00Z")).toBe("22 Sep 2026");
  });
});

describe("unverified imports", () => {
  it("flags the Sortly imports by source or by SRT- tag", () => {
    expect(isUnverifiedImport({ tag: "SRT-0011-03", source: null })).toBe(true);
    expect(isUnverifiedImport({ tag: "X-1", source: { origin: "sortly", unverified: true } })).toBe(true);
    expect(isUnverifiedImport({ tag: "UCL0001", source: { tab: "Upstairs Classroom (DTS-DBS)", row: 2 } })).toBe(false);
    expect(isUnverifiedImport({ tag: "AUD-0001" })).toBe(false);
  });

  it("says where a unit came from", () => {
    expect(sourceText({ sheet: "FFSA INVENTORY", tab: "SBS-Poolside Classroom", row: 4 })).toBe(
      "FFSA INVENTORY · SBS-Poolside Classroom, row 4"
    );
    expect(sourceText({ origin: "sortly", unverified: true, sortly_row: 15, sid: "SDJDKT0011" })).toBe(
      "First Sortly inventory · SDJDKT0011 · row 15 · not yet verified"
    );
    expect(sourceText(null)).toBeNull();
  });
});

describe("filterRegister", () => {
  const u = (tag: string, over: Partial<Parameters<typeof filterRegister>[0][number]["units"][number]> = {}) => ({
    tag,
    serial: "S1",
    label: null,
    ownerLabel: null as string | null,
    locationId: "aud" as string | null,
    location: "Auditorium" as string | null,
    unverified: false,
    ...over,
  });
  const products = [
    {
      name: "Vocal microphone",
      make: "Audio-Technica · ATM510",
      category: "audio",
      units: [
        u("AUD-0066", { ownerLabel: "Prayer & Worship Ministry" }),
        u("UCL0014", { ownerLabel: "DTS/DBS/LTS Schools", locationId: "ucl", location: "Upstairs Classroom" }),
        u("SBS-0009", { ownerLabel: "SBS School", locationId: "sbs", location: "SBS Classroom" }),
      ],
    },
    {
      name: "Mic stands",
      make: "",
      category: "auxiliary",
      units: [u("SRT-0011-01", { locationId: null, location: null, unverified: true })],
    },
    {
      name: "Television 58\"",
      make: "Hisense · 58A6N",
      category: "visual",
      units: [u("DBS-0001", { ownerLabel: "DBS", locationId: "old", location: "Old Prayer Room" })],
    },
  ];
  const all = { category: "all", location: "all", query: "" };
  const tags = (r: ReturnType<typeof filterRegister>) => r.map((x) => x.units.map((y) => y.tag));

  it("shows everything by default", () => {
    expect(tags(filterRegister(products, all))).toEqual([["AUD-0066", "UCL0014", "SBS-0009"], ["SRT-0011-01"], ["DBS-0001"]]);
  });

  it("filters units by location and drops products left empty", () => {
    expect(tags(filterRegister(products, { ...all, location: "sbs" }))).toEqual([["SBS-0009"]]);
    expect(tags(filterRegister(products, { ...all, location: NO_LOCATION }))).toEqual([["SRT-0011-01"]]);
  });

  it("combines category and location", () => {
    expect(filterRegister(products, { ...all, category: "visual", location: "sbs" })).toEqual([]);
    expect(tags(filterRegister(products, { ...all, category: "visual" }))).toEqual([["DBS-0001"]]);
  });

  it("finds units by owner label, opening the product to just those", () => {
    const r = filterRegister(products, { ...all, query: "sbs school" });
    expect(tags(r)).toEqual([["SBS-0009"]]);
    expect(r[0].viaUnits).toBe(true);
    expect(tags(filterRegister(products, { ...all, query: "DBS" }))).toEqual([["UCL0014"], ["DBS-0001"]]);
  });

  it("finds units by location name and the unverified ones by the word", () => {
    expect(tags(filterRegister(products, { ...all, query: "upstairs" }))).toEqual([["UCL0014"]]);
    expect(tags(filterRegister(products, { ...all, query: "unverified" }))).toEqual([["SRT-0011-01"]]);
  });

  it("still matches products by name or make, with all their units in the location", () => {
    const r = filterRegister(products, { ...all, query: "atm510", location: "ucl" });
    expect(tags(r)).toEqual([["UCL0014"]]);
    expect(r[0].viaUnits).toBe(false);
  });
});
