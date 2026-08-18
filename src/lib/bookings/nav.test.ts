import { describe, it, expect } from "vitest";
import { buildSpacesHref, type SpacesNavState } from "./nav";

const base: SpacesNavState = {
  view: "day",
  date: "2026-08-18",
  venue: "all",
  ministry: "all",
};

describe("buildSpacesHref", () => {
  it("leaves the default view out of the query string", () => {
    expect(buildSpacesHref(base)).toBe("/bookings/spaces?date=2026-08-18");
  });

  it("writes a non-default view", () => {
    expect(buildSpacesHref({ ...base, view: "month" })).toBe(
      "/bookings/spaces?view=month&date=2026-08-18"
    );
  });

  it("carries the venue and ministry filters, dropping 'all'", () => {
    expect(buildSpacesHref({ ...base, venue: "v1" })).toBe(
      "/bookings/spaces?date=2026-08-18&venue=v1"
    );
    expect(buildSpacesHref({ ...base, venue: "v1", ministry: "m1" })).toBe(
      "/bookings/spaces?date=2026-08-18&venue=v1&ministry=m1"
    );
  });

  // The regression this module exists for. On Vercel the page renders in UTC
  // while the button is clicked in SAST, so for two hours every evening the
  // two disagree about what "today" is. When the date was omitted for being
  // "today", stepping forward onto the browser's today produced a link with no
  // date at all — and the server answered with ITS today, one day earlier.
  // Forward appeared dead; back worked.
  it("always writes the date, even when it is the viewer's today", () => {
    const browserToday = "2026-08-19"; // SAST
    const serverRendered = "2026-08-18"; // UTC, one day behind
    const nextDay = browserToday; // what "next day" resolves to from the 18th

    const href = buildSpacesHref({ ...base, date: nextDay });

    expect(href).toContain("date=2026-08-19");
    expect(href).not.toBe("/bookings/spaces");
    // The link must not silently resolve back to what the server already showed.
    expect(href).not.toContain(serverRendered);
  });
});
