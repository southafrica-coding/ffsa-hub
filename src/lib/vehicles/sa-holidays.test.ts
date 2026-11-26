import { describe, expect, it } from "vitest";
import { easterSunday, isSaPublicHoliday, isWorkingDay } from "./sa-holidays";
import { SA_PUBLIC_HOLIDAYS, NATIONAL_YEARS } from "@/lib/missio/calendar/south-africa";

describe("South African public holidays by rule", () => {
  it("matches the official 2026–2028 list (Missio calendar, gov.za) day for day", () => {
    for (const y of NATIONAL_YEARS) {
      const official = new Set(SA_PUBLIC_HOLIDAYS[y].map((h) => h.date));
      for (let t = Date.UTC(y, 0, 1); t < Date.UTC(y + 1, 0, 1); t += 86_400_000) {
        const d = new Date(t).toISOString().slice(0, 10);
        expect([d, isSaPublicHoliday(d)]).toEqual([d, official.has(d)]);
      }
    }
  });

  it("knows Easter", () => {
    expect(["2026", "2027", "2028", "2029", "2030"].map((y) => easterSunday(Number(y)))).toEqual([
      "2026-04-05", "2027-03-28", "2028-04-16", "2029-04-01", "2030-04-21",
    ]);
  });

  it("weekends and holidays aren't working days", () => {
    expect(isWorkingDay("2026-12-16")).toBe(false); // Wed, Day of Reconciliation
    expect(isWorkingDay("2026-08-10")).toBe(false); // Mon, Women's Day observed
    expect(isWorkingDay("2026-12-19")).toBe(false); // Sat
    expect(isWorkingDay("2026-12-17")).toBe(true);
  });
});
