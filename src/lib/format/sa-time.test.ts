import { afterAll, describe, expect, it } from "vitest";
import {
  formatDayRange,
  formatSaDate,
  formatSaDateTime,
  formatSaTime,
} from "./sa-time";

const ORIGINAL_TZ = process.env.TZ;
process.env.TZ = "America/New_York";

// 22:15:30 UTC is 00:15:30 the next calendar day in South Africa (UTC+2,
// no daylight saving) and 17:15:30 the same day in New York (EST).
const INSTANT = new Date("2026-11-10T22:15:30.000Z");
const SAST_DATE_TIME = "11 Nov 2026, 00:15:30";
const SAST_TIME = "00:15:30";
const SAST_DATE = "11 Nov 2026";

// Johannesburg midnight. hourCycle "h24" would render this hour as 24.
const MIDNIGHT = new Date("2026-11-10T22:00:00.000Z");

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("formatSaDateTime", () => {
  it("formats a fixed instant as dd MMM yyyy, HH:mm:ss in Johannesburg when the process TZ is New York", () => {
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
      "America/New_York"
    );

    expect(formatSaDateTime(INSTANT)).toBe(SAST_DATE_TIME);
    expect(formatSaDateTime(INSTANT.toISOString())).toBe(SAST_DATE_TIME);
    expect(formatSaDateTime(INSTANT.getTime())).toBe(SAST_DATE_TIME);
    expect(formatSaDateTime(INSTANT)).not.toContain("17:15");
  });

  it("renders Johannesburg midnight as 00, never 24", () => {
    expect(formatSaDateTime(MIDNIGHT)).toBe("11 Nov 2026, 00:00:00");
    expect(formatSaTime(MIDNIGHT)).toBe("00:00:00");
    expect(formatSaDateTime(MIDNIGHT)).not.toContain("24:");
    expect(formatSaTime(MIDNIGHT)).not.toMatch(/^24/);
  });
});

describe("formatSaTime", () => {
  it("formats the clock as HH:mm:ss in Johannesburg, not the process zone", () => {
    expect(formatSaTime(INSTANT)).toBe(SAST_TIME);
    expect(formatSaTime(INSTANT)).not.toBe("17:15:30");
  });
});

describe("formatSaDate", () => {
  it("formats the South African calendar date, including the day after midnight UTC", () => {
    expect(formatSaDate(INSTANT)).toBe(SAST_DATE);
    expect(formatSaDate(MIDNIGHT)).toBe("11 Nov 2026");
  });
});

describe("formatDayRange", () => {
  it("formats a calendar date in UTC so New York does not shift the day", () => {
    // 2026-01-01T00:00:00Z is still 31 Dec in New York. The column is a date.
    expect(formatDayRange("2026-01-01", null)).toBe("01 Jan 2026");
    expect(formatDayRange("2026-09-12", "2026-09-12")).toBe("12 Sep 2026");
    expect(formatDayRange("2026-09-12", "2026-09-14")).toBe(
      "12 Sep 2026 – 14 Sep 2026"
    );
  });
});
