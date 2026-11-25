import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  activityDay,
  isCountableRequest,
  recordUserActivity,
  resetMobileSeen,
  shouldRecordMobile,
} from "@/lib/user-activity";

const hdrs = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });

describe("activityDay", () => {
  it("uses the Johannesburg calendar day, not UTC", () => {
    // 22:30 UTC on the 24th is 00:30 SAST on the 25th.
    expect(activityDay(new Date("2026-11-24T22:30:00Z"))).toBe("2026-11-25");
    expect(activityDay(new Date("2026-11-24T21:30:00Z"))).toBe("2026-11-24");
  });
});

describe("isCountableRequest", () => {
  it("skips HEAD, OPTIONS and prefetches", () => {
    expect(isCountableRequest({ method: "GET", headers: hdrs({}) })).toBe(true);
    expect(isCountableRequest({ method: "HEAD", headers: hdrs({}) })).toBe(false);
    expect(isCountableRequest({ method: "OPTIONS", headers: hdrs({}) })).toBe(false);
    expect(isCountableRequest({ method: "GET", headers: hdrs({ "next-router-prefetch": "1" }) })).toBe(false);
    expect(isCountableRequest({ method: "GET", headers: hdrs({ purpose: "prefetch" }) })).toBe(false);
  });
});

describe("recordUserActivity", () => {
  it("calls the RPC with only the platform", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await recordUserActivity({ rpc }, "web");
    expect(rpc).toHaveBeenCalledWith("record_user_activity", { p_platform: "web" });
  });
  it("never throws", async () => {
    await expect(recordUserActivity({ rpc: () => { throw new Error("x"); } }, "web")).resolves.toBeUndefined();
    await expect(recordUserActivity({ rpc: () => Promise.reject(new Error("x")) }, "mobile")).resolves.toBeUndefined();
  });
});

describe("shouldRecordMobile", () => {
  beforeEach(() => resetMobileSeen());
  it("is true once per user per day", () => {
    expect(shouldRecordMobile("u1", "2026-11-25")).toBe(true);
    expect(shouldRecordMobile("u1", "2026-11-25")).toBe(false);
    expect(shouldRecordMobile("u2", "2026-11-25")).toBe(true);
    expect(shouldRecordMobile("u1", "2026-11-26")).toBe(true);
  });
});
