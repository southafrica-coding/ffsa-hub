import { describe, expect, it } from "vitest";
import { seedFleetData, withVehicle } from "./testing/seed";
import { GUIDE, changeDate, guidePage, guideText, guideTokens, lastUpdated, stepKey, tutorialSteps } from "./guide";

const F = seedFleetData("2026-11-17");

describe("guideTokens", () => {
  it("fills every token from the live data, as the app's guideTokens", () => {
    expect(guideTokens(F)).toEqual({
      pre: 7,
      post: 14,
      weekly: 60,
      monthly: 96,
      workshop: 23,
      days: "Tuesdays, Wednesdays and Thursdays",
      max: 2,
      inspectKm: "5 000 km",
      serviceKm: "10 000 km",
      warnKm: "500 km",
      budget: "5 hours",
      v: "h1-1",
    });
  });

  it("follows the settings: one day, budget, first vehicle in use", () => {
    const G = withVehicle({ ...F, schedule: { ...F.schedule, days: [5], maxPerDay: 3, budgetHours: 4.5 } }, "h1-1", { status: "For sale" });
    const tk = guideTokens(G);
    expect(tk.days).toBe("Fridays");
    expect(tk.max).toBe(3);
    expect(tk.budget).toBe("4.5 hours");
    expect(tk.v).toBe("h1-2");
    expect(guideTokens({ ...F, schedule: { ...F.schedule, days: [1, 2] } }).days).toBe("Mondays and Tuesdays");
  });

  it("has no vehicle id when there are no vehicles in use", () => {
    expect(guideTokens({ ...F, vehicles: [] }).v).toBe("");
  });
});

describe("guideText", () => {
  it("fills known tokens and leaves unknown ones", () => {
    const tk = guideTokens(F);
    expect(guideText("On inspection days ({days}), at most {max} a day; {nope}", tk)).toBe(
      "On inspection days (Tuesdays, Wednesdays and Thursdays), at most 2 a day; {nope}"
    );
    expect(guideText("Budget {budget}, warn {warnKm}", tk)).toBe("Budget 5 hours, warn 500 km");
  });

  it("every token in the Guide is one guideTokens knows", () => {
    const known = new Set(Object.keys(guideTokens(F)));
    const used = new Set<string>();
    const scan = (s: unknown) => {
      if (typeof s === "string") for (const m of s.matchAll(/\{(\w+)\}/g)) used.add(m[1]);
      else if (Array.isArray(s)) s.forEach(scan);
      else if (s && typeof s === "object") Object.values(s).forEach(scan);
    };
    scan(GUIDE.pages);
    scan(GUIDE.changes);
    expect([...used].filter((k) => !known.has(k))).toEqual([]);
  });
});

describe("the Guide content", () => {
  it("has the six pages in order", () => {
    expect(GUIDE.pages.map((p) => p.title)).toEqual(["Start here", "Tutorial", "Handover", "How it works", "Problems", "What’s new"]);
  });

  it("says Fleet is part of the FFSA Hub, and no longer private to its owner", () => {
    const start = JSON.stringify(guidePage("start").page);
    expect(start).not.toMatch(/private/i);
    expect(start).toContain("Bookings → Vehicles → Fleet");
    expect(start).toContain("Vehicle Co-ordinator role");
    expect(start).toMatch(/Hub admins/);
  });

  it("lists the 17 Nov 2026 change in What's new", () => {
    const entry = GUIDE.changes.find(([, t]) => t.startsWith("Fleet is now part of the FFSA Hub"));
    expect(entry?.[0]).toBe("2026-11-17");
  });

  it("finds pages, with the first one as the fallback", () => {
    expect(guidePage("handover").page.id).toBe("handover");
    expect(guidePage("handover").prev?.id).toBe("tutorial");
    expect(guidePage("handover").next?.id).toBe("how");
    expect(guidePage("nope").page.id).toBe("start");
    expect(guidePage(undefined).prev).toBeUndefined();
    expect(guidePage("changes").next).toBeUndefined();
  });
});

describe("What's new dates", () => {
  it("formats dates and placeholders", () => {
    expect(changeDate("2026-11-17")).toBe("17 Nov 2026");
    expect(changeDate("go-live")).toBe("Go-live");
  });
  it("last updated is the newest dated entry", () => {
    expect(lastUpdated([["go-live", "x"], ["2026-11-17", "y"], ["2026-11-16", "z"]])).toBe("17 Nov 2026");
    expect(lastUpdated()).toBe("17 Nov 2026");
    expect(lastUpdated([["go-live", "x"]])).toBe("");
  });
});

describe("tutorial steps", () => {
  it("have unique, stable keys", () => {
    const keys = tutorialSteps().map(([t]) => stepKey(t));
    expect(keys.length).toBeGreaterThan(5);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe("open-today");
    expect(stepKey("Log a km reading")).toBe("log-a-km-reading");
  });
});
