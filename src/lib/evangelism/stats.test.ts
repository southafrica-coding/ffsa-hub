import { describe, expect, it } from "vitest";
import { aggregateTestimonies, statsWindow } from "./stats";

describe("statsWindow", () => {
  const today = "2026-11-06";

  it("uses the Johannesburg calendar, not a rolling 30 days", () => {
    expect(statsWindow("month", today)).toEqual({ from: "2026-11-01", to: today });
    expect(statsWindow("week", today)).toEqual({ from: "2026-10-31", to: today });
    expect(statsWindow("quarter", today)).toEqual({ from: "2026-10-01", to: today });
    expect(statsWindow("year", today)).toEqual({ from: "2026-01-01", to: today });
    expect(statsWindow("all", today).from).toBe("1970-01-01");
  });
});

describe("aggregateTestimonies", () => {
  it("sums people and decisions and groups by location", () => {
    const stats = aggregateTestimonies(
      [
        {
          occurred_on: "2026-11-02",
          location_label: "Durban base",
          people_reached: 10,
          decisions: 2,
          outcome: "decision",
          published_at: "2026-11-02T10:00:00.000Z",
        },
        {
          occurred_on: "2026-11-03",
          location_label: "Durban base",
          people_reached: 3,
          decisions: 0,
          outcome: "conversation",
          published_at: "2026-11-04T10:00:00.000Z",
        },
        {
          occurred_on: "2026-11-03",
          location_label: "Point",
          people_reached: 8,
          decisions: 1,
          outcome: "prayer",
          published_at: "2026-11-03T10:00:00.000Z",
        },
      ],
      { range: "month", from: "2026-11-01", to: "2026-11-06" }
    );

    expect(stats.published_count).toBe(3);
    expect(stats.people_reached).toBe(21);
    expect(stats.decisions).toBe(3);
    expect(stats.by_outcome).toEqual({ decision: 1, conversation: 1, prayer: 1 });
    expect(stats.by_location[0]).toMatchObject({ location_label: "Durban base", testimonies: 2, people_reached: 13 });
    expect(stats.latest_published_at).toBe("2026-11-04T10:00:00.000Z");
    expect(stats.timezone).toBe("Africa/Johannesburg");
  });
});
