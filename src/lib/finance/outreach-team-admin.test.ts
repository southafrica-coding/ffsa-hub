import { describe, expect, it } from "vitest";
import { describeDeleteBlockers, isSafeToDelete } from "./outreach-team-admin";

describe("isSafeToDelete", () => {
  it("is safe only when the check ran and found nothing", () => {
    expect(isSafeToDelete({})).toBe(true);
    expect(isSafeToDelete({ outreach_expenses: 0 })).toBe(true);
    expect(isSafeToDelete({ outreach_expenses: 3 })).toBe(false);
    expect(isSafeToDelete({ people: 1 })).toBe(false);
  });

  it("treats a missing answer (not allowed / error) as not safe", () => {
    expect(isSafeToDelete(null)).toBe(false);
    expect(isSafeToDelete(undefined)).toBe(false);
  });
});

describe("describeDeleteBlockers", () => {
  it("words each linked record for people, singular and plural", () => {
    expect(
      describeDeleteBlockers({ outreach_expenses: 12, outreach_fund_releases: 1, people: 2 })
    ).toEqual(["2 people on the team besides the owner", "1 fund release", "12 expenses"]);
  });

  it("skips zero counts and still names tables it doesn't know", () => {
    expect(describeDeleteBlockers({ outreach_closeouts: 0, outreach_new_thing: 2 })).toEqual([
      "2 new thing",
    ]);
  });

  it("returns nothing for a safe or missing answer", () => {
    expect(describeDeleteBlockers({})).toEqual([]);
    expect(describeDeleteBlockers(null)).toEqual([]);
  });
});
