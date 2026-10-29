import { describe, it, expect } from "vitest";
import {
  attentionText,
  checkedText,
  hasFault,
  hasNoSerial,
  needsAttention,
  sastDate,
  shortDate,
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
