import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrayerWeekCard } from "./prayer-week-card";

describe("Prayer week card", () => {
  it("uses sentence case on the card copy", () => {
    const html = renderToStaticMarkup(<PrayerWeekCard />);
    expect(html).toContain("Prayer room · This week");
    expect(html).not.toContain("This Week");
    expect(html).not.toContain("Prayer Room");
    expect(html).toContain("Loading this week’s schedule…");
    expect(html).toContain(">Open<");
  });
});
