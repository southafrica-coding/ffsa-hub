import { describe, expect, it } from "vitest";
import { coachBranches } from "./house-map";
import type { HouseSummary } from "./types";

const coach = (id: string, name: string) => ({
  contactId: id,
  displayName: name,
  firstName: name.split(" ")[0] ?? null,
  lastName: name.split(" ")[1] ?? null,
  since: "2026-11-19",
});

const house = (number: number, size: number, coaches: ReturnType<typeof coach>[]): HouseSummary => ({
  id: `h${number}`,
  number,
  name: null,
  campus: "potch",
  meetingDay: null,
  location: null,
  memberCount: size,
  leaders: [],
  coLeaders: [],
  coaches,
});

describe("coachBranches", () => {
  it("puts a house with two coaches under both, and houses with none last", () => {
    const thandi = coach("c-t", "Thandi Zulu");
    const pieter = coach("c-p", "Pieter van Wyk");
    const branches = coachBranches([house(1, 10, [thandi, pieter]), house(2, 8, [thandi]), house(3, 5, [])]);
    expect(branches.map((branch) => [branch.name, branch.houses.map((h) => h.number), branch.people])).toEqual([
      ["Thandi Zulu", [1, 2], 18],
      ["Pieter van Wyk", [1], 10],
      ["No coach yet", [3], 5],
    ]);
  });
});
