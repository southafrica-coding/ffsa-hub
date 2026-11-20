// The booking board's fleet calendar shows 30 days from today (SA), not a calendar month.

import { afterEach, describe, expect, it, vi } from "vitest";
import { calendarWindow } from "./fleet-calendar";

afterEach(() => vi.useRealTimers());
const at = (isoUtc: string) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(isoUtc));
};

describe("calendarWindow", () => {
  it("starts today and runs 30 days into the next month", () => {
    at("2026-11-19T10:00:00Z");
    const w = calendarWindow();
    expect(w).toMatchObject({ from: "2026-11-19", to: "2026-12-18", prev: "2026-10-20", next: "2026-12-19", isToday: true });
  });

  it("uses South African today, not UTC, just before midnight UTC", () => {
    at("2026-11-19T22:30:00Z"); // 00:30 on the 20th in SA
    expect(calendarWindow().from).toBe("2026-11-20");
  });

  it("back and forward move 30 days", () => {
    at("2026-11-19T10:00:00Z");
    const w = calendarWindow("2026-12-19");
    expect(w).toMatchObject({ from: "2026-12-19", to: "2027-01-17", isToday: false });
  });

  it("old ?month= links still open: this month from today, another on the 1st", () => {
    at("2026-11-19T10:00:00Z");
    expect(calendarWindow("2026-11").from).toBe("2026-11-19");
    expect(calendarWindow("2027-01").from).toBe("2027-01-01");
  });

  it("ignores a malformed date", () => {
    at("2026-11-19T10:00:00Z");
    expect(calendarWindow("nonsense").from).toBe("2026-11-19");
  });
});
