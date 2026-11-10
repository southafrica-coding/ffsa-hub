import { afterAll, describe, expect, it } from "vitest";
import { formatSaDate, formatSaDateTime, formatSaTime } from "./sa-time";

const ORIGINAL_TZ = process.env.TZ;
process.env.TZ = "America/New_York";

// 22:15:30 UTC is 00:15:30 the next calendar day in South Africa (UTC+2,
// no daylight saving) and 17:15:30 the same day in New York (EST).
const INSTANT = new Date("2026-11-10T22:15:30.000Z");
const SAST_DATE_TIME = "2026/11/11, 00:15:30";
const SAST_TIME = "00:15:30";
const SAST_DATE = "2026/11/11";

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("formatSaDateTime", () => {
  it("formats a fixed instant in Africa/Johannesburg when the process TZ is New York", () => {
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
      "America/New_York"
    );

    const local = INSTANT.toLocaleString("en-ZA");
    expect(local).toBe("2026/11/10, 17:15:30");
    expect(local).not.toBe(SAST_DATE_TIME);

    expect(formatSaDateTime(INSTANT)).toBe(SAST_DATE_TIME);
    expect(formatSaDateTime(INSTANT.toISOString())).toBe(SAST_DATE_TIME);
    expect(formatSaDateTime(INSTANT.getTime())).toBe(SAST_DATE_TIME);
  });
});

describe("formatSaTime", () => {
  it("formats the clock time in Africa/Johannesburg, not the process zone", () => {
    expect(INSTANT.toLocaleTimeString("en-ZA")).toBe("17:15:30");
    expect(formatSaTime(INSTANT)).toBe(SAST_TIME);
  });
});

describe("formatSaDate", () => {
  it("formats the South African calendar date, including the day after midnight UTC", () => {
    expect(INSTANT.toLocaleDateString("en-ZA")).toBe("2026/11/10");
    expect(formatSaDate(INSTANT)).toBe(SAST_DATE);
  });
});
