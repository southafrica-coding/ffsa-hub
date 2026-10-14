import { describe, expect, it } from "vitest";

import {
  periodRange,
  pickTeam,
  resolveCategory,
  sastDate,
  summarise,
  type OutreachScope,
} from "./outreach";

const CATS = ["Flights", "Accommodation", "Food", "Transport", "Emergency Fund", "Airport Run"].map((name, i) => ({
  id: `c${i}`,
  name,
  slug: name.toLowerCase().replace(/ /g, "-"),
  sort_order: i,
}));
const cat = (t: string) => resolveCategory(t, CATS)?.name ?? null;

const BOTS = { id: "t1", team_name: "Botswana", country: "Botswana", role: "finance_student" };
const HULC = { id: "t2", team_name: "HULC Hartenbos 2026", country: "South Africa", role: "team_member" };

const scope = (over: Partial<OutreachScope>): OutreachScope => ({
  hubUserId: "u",
  defaultTeamId: null,
  teams: [BOTS],
  inTeamChannel: false,
  ...over,
});

describe("pickTeam", () => {
  it("uses the conversation's team when none is named", () => {
    const p = pickTeam(scope({ defaultTeamId: "t1" }));
    expect(p.ok && p.team.team_name).toBe("Botswana");
  });

  it("asks which when someone on two teams doesn't say", () => {
    const p = pickTeam(scope({ teams: [BOTS, HULC] }));
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.candidates).toEqual(["Botswana", "HULC Hartenbos 2026"]);
  });

  it("matches a named team loosely, by part of the name or country", () => {
    const s = scope({ teams: [BOTS, HULC] });
    expect(pickTeam(s, "hartenbos").ok).toBe(true);
    const byCountry = pickTeam(s, "botswana");
    expect(byCountry.ok && byCountry.team.id).toBe("t1");
  });

  it("prefers a team's name over another team's country", () => {
    const test = { id: "t3", team_name: "ZZ Test", country: "Botswana", role: null };
    const p = pickTeam(scope({ teams: [test, { ...BOTS, role: null }] }), "Botswana");
    expect(p.ok && p.team.id).toBe("t1");
  });

  it("never reaches a team outside the asker's scope", () => {
    const p = pickTeam(scope({ defaultTeamId: "t1" }), "HULC");
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.candidates).toEqual(["Botswana"]);
  });
});

describe("resolveCategory", () => {
  it.each([
    ["gas", "Transport"],
    ["petrol", "Transport"],
    ["the gas budget", "Transport"],
    ["groceries", "Food"],
    ["food", "Food"],
    ["Food", "Food"],
    ["accomodation", "Accommodation"],
    ["emergency", "Emergency Fund"],
    ["airport run", "Airport Run"],
  ])("%s → %s", (word, expected) => {
    expect(cat(word)).toBe(expected);
  });

  it("returns null for a word with no category", () => {
    expect(cat("souvenirs")).toBeNull();
  });
});

describe("summarise", () => {
  it("gives planned, spent and left per category and overall", () => {
    const s = summarise(
      CATS,
      [
        { category_id: "c2", description: "Destination A - Food", total_zar: "22800.00" },
        { category_id: "c3", description: "Fuel", total_zar: 4800 },
      ],
      [
        { category_id: "c3", zar_amount: "1000.50" },
        { category_id: "c3", zar_amount: 2039.5 },
        { category_id: "c1", zar_amount: 300 },
      ]
    );
    const transport = s.categories.find((c) => c.category === "Transport")!;
    expect(transport).toEqual({ category: "Transport", planned: 4800, spent: 3040, left: 1760, receipts: 2 });
    // Money spent on something never planned still shows up, as overspent.
    expect(s.categories.find((c) => c.category === "Accommodation")).toMatchObject({ planned: 0, left: -300 });
    expect(s.totals).toEqual({ planned: 27600, spent: 3340, left: 24260 });
    // Kept in the category order the Hub uses.
    expect(s.categories.map((c) => c.category)).toEqual(["Accommodation", "Food", "Transport"]);
  });
});

describe("dates (SAST)", () => {
  // 23:30 UTC on Tue 27 Oct is already Wed 28 Oct in SA / Botswana.
  const late = new Date("2026-10-27T23:30:00Z");

  it("uses the SA calendar day, not UTC", () => {
    expect(sastDate(late)).toBe("2026-10-28");
  });

  it("works out today, yesterday and this week (from Monday)", () => {
    expect(periodRange("today", late)).toMatchObject({ from: "2026-10-28", to: "2026-10-28" });
    expect(periodRange("yesterday", late)).toMatchObject({ from: "2026-10-27", to: "2026-10-27" });
    expect(periodRange("this_week", late)).toMatchObject({ from: "2026-10-26", to: "2026-10-28" });
    expect(periodRange(undefined, late)).toMatchObject({ from: null, to: null });
  });
});
