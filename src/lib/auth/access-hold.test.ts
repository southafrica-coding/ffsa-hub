import { describe, expect, it } from "vitest";
import { formatOpensOn, isAccessHeld, todaySast } from "./access-hold";

describe("todaySast", () => {
  it("rolls over at midnight South African time, not UTC", () => {
    // 22:30 UTC on 14 Jan is 00:30 SAST on 15 Jan.
    expect(todaySast(new Date("2027-01-14T22:30:00Z"))).toBe("2027-01-15");
    expect(todaySast(new Date("2027-01-14T21:30:00Z"))).toBe("2027-01-14");
  });
});

describe("isAccessHeld", () => {
  it("holds before the date and opens on it", () => {
    expect(isAccessHeld("2027-01-15", "2027-01-14")).toBe(true);
    expect(isAccessHeld("2027-01-15", "2027-01-15")).toBe(false);
    expect(isAccessHeld("2027-01-15", "2027-02-01")).toBe(false);
  });
  it("never holds on a missing or garbled date", () => {
    expect(isAccessHeld(null, "2027-01-01")).toBe(false);
    expect(isAccessHeld("", "2027-01-01")).toBe(false);
    expect(isAccessHeld("15/01/2027", "2027-01-01")).toBe(false);
  });
});

describe("formatOpensOn", () => {
  it("reads as a date people say out loud", () => {
    expect(formatOpensOn("2027-01-15")).toMatch(/15 January 2027/);
  });
});
