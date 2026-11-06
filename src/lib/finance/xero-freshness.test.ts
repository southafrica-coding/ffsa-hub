import { describe, expect, it } from "vitest";
import { describeXeroFreshness, type XeroMirrorFreshness } from "./xero-freshness";

const at = "2026-11-06T08:30:00.000Z"; // 10:30 SAST

const f = (lastRun: XeroMirrorFreshness["lastRun"], lastUpdatedAt: string | null = at): XeroMirrorFreshness => ({
  region: "za",
  lastUpdatedAt,
  lastRun,
});

describe("describeXeroFreshness", () => {
  it("says when the copy was updated, in SAST", () => {
    const line = describeXeroFreshness(f({ status: "succeeded", started_at: at, finished_at: at, error: null }));
    expect(line).toEqual({ tone: "good", text: "Updated from Xero 6 Nov, 10:30" });
  });

  it("a disconnected org says so and still points at the last copy, without asking anyone to sync", () => {
    const line = describeXeroFreshness(f({ status: "skipped", started_at: at, finished_at: at, error: "not connected" }));
    expect(line.tone).toBe("warn");
    expect(line.text).toBe("Not connected to Xero. Showing the copy last updated from Xero 6 Nov, 10:30.");
    expect(line.text).not.toMatch(/sync/i);
  });

  it("a failed read keeps the last copy and gives the reason, shortened", () => {
    const line = describeXeroFreshness(f({ status: "failed", started_at: at, finished_at: at, error: "x".repeat(400) }, null));
    expect(line.tone).toBe("bad");
    expect(line.text).toMatch(/^Xero could not be read at 6 Nov, 10:30 \(x+…\)\. Nothing has been read from Xero yet\.$/);
    expect(line.text.length).toBeLessThan(260);
  });

  it("before any run", () => {
    expect(describeXeroFreshness(undefined)).toEqual({ tone: "quiet", text: "Not read from Xero yet." });
  });
});
