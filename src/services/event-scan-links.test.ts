import { describe, expect, it } from "vitest";
import { expiryFor } from "./event-scan-links";

// Noon UTC is 14:00 in Johannesburg, so the calendar day matches both zones.
const NOW = new Date("2026-11-10T12:00:00Z");

describe("expiryFor", () => {
  it("is not already past when the event ended weeks ago", () => {
    // Prayer and Worship In Ear Fundraiser ran 7–14 Sep 2026. The old rule
    // (end of that day UTC + 14) produced 2026-09-28T23:59:59Z, already over
    // by the time a link was minted in November.
    const iso = expiryFor(
      { start_date: "2026-09-07", end_date: "2026-09-14" },
      NOW
    );
    expect(new Date(iso).getTime()).toBeGreaterThan(NOW.getTime());
    // Later of (14 Sep + 14 days) and (10 Nov + 14 days), end of that day in SAST.
    expect(iso).toBe("2026-11-24T21:59:59.000Z");
  });

  it("keeps event end plus 14 days when the event is still ahead", () => {
    const iso = expiryFor(
      { start_date: "2026-12-01", end_date: "2026-12-20" },
      NOW
    );
    expect(iso).toBe("2027-01-03T21:59:59.000Z");
  });

  it("uses start_date when end_date is null", () => {
    const iso = expiryFor({ start_date: "2026-12-01", end_date: null }, NOW);
    expect(iso).toBe("2026-12-15T21:59:59.000Z");
  });
});
