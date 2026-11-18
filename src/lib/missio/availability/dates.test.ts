import { describe, expect, it } from "vitest";
import {
  canEditAvailability,
  formatServiceLabel,
  isTokenExpired,
  johannesburgToday,
  sundaysBetween,
  tokenExpiresAt,
  visibleServiceDates,
} from "./dates";

describe("canEditAvailability", () => {
  const today = "2026-11-18";

  it("stays open on the service date", () => {
    expect(canEditAvailability("2026-11-18", today)).toBe(true);
  });

  it("stays open before the service date", () => {
    expect(canEditAvailability("2026-11-22", today)).toBe(true);
  });

  it("closes the day after the service date", () => {
    expect(canEditAvailability("2026-11-17", today)).toBe(false);
  });

  it("rejects a date that is not a real calendar day", () => {
    expect(canEditAvailability("2026-02-31", today)).toBe(false);
    expect(canEditAvailability("18 Nov 2026", today)).toBe(false);
  });
});

describe("johannesburgToday", () => {
  it("keeps the same calendar day before 22:00 UTC", () => {
    expect(johannesburgToday(new Date("2026-11-18T21:30:00.000Z"))).toBe("2026-11-18");
  });

  it("rolls to the next calendar day at 00:00 SAST", () => {
    expect(johannesburgToday(new Date("2026-11-18T22:30:00.000Z"))).toBe("2026-11-19");
  });
});

describe("visibleServiceDates", () => {
  const dates = ["2026-11-15", "2026-11-22", "2026-11-29", "2026-12-06", "2026-12-13", "2026-12-20", "2026-12-27"];

  it("shows the next six upcoming dates", () => {
    expect(visibleServiceDates(dates, "2026-11-18")).toEqual([
      "2026-11-22",
      "2026-11-29",
      "2026-12-06",
      "2026-12-13",
      "2026-12-20",
      "2026-12-27",
    ]);
  });

  it("pulls in the latest past date when fewer than four are still ahead", () => {
    expect(visibleServiceDates(dates, "2026-12-07")).toEqual(["2026-12-06", "2026-12-13", "2026-12-20", "2026-12-27"]);
  });

  it("shows every date when the request is shorter than four", () => {
    expect(visibleServiceDates(["2026-11-22", "2026-11-29"], "2026-11-18")).toEqual(["2026-11-22", "2026-11-29"]);
  });
});

describe("token expiry and Sundays", () => {
  it("expires at 00:00 SAST the day after the last service date", () => {
    expect(tokenExpiresAt(["2026-11-22", "2026-11-15"])).toBe("2026-11-22T22:00:00.000Z");
    expect(isTokenExpired("2026-11-22T22:00:00.000Z", new Date("2026-11-22T21:59:00.000Z"))).toBe(false);
    expect(isTokenExpired("2026-11-22T22:00:00.000Z", new Date("2026-11-22T22:00:00.000Z"))).toBe(true);
  });

  it("lists Sundays inside the range, capped at 12", () => {
    expect(sundaysBetween("2026-11-16", "2026-11-30")).toEqual(["2026-11-22", "2026-11-29"]);
    expect(sundaysBetween("2026-01-01", "2026-06-01")).toHaveLength(12);
  });

  it("formats a Sunday without a comma", () => {
    expect(formatServiceLabel("2026-11-22", "long")).toBe("Sunday 22 Nov");
    expect(formatServiceLabel("2026-11-22", "short")).toBe("22 Nov");
  });
});
