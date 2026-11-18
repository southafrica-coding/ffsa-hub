import { describe, expect, it } from "vitest";
import { aggregateAvailabilityGrid, teamRoster, unansweredContacts } from "./grid";

const DATES = ["2026-11-22", "2026-11-29"];

describe("aggregateAvailabilityGrid", () => {
  const teams = [
    { id: "band", name: "Sunday band", memberIds: ["sam", "alex"], leaderIds: ["noor"] },
    { id: "welcome", name: "Welcome", memberIds: ["jo", "sam"], leaderIds: [] },
  ];

  const responses = [
    { contactId: "sam", serviceDate: "2026-11-22", status: "available" as const },
    { contactId: "alex", serviceDate: "2026-11-22", status: "unavailable" as const },
    { contactId: "alex", serviceDate: "2026-11-29", status: "maybe" as const },
    { contactId: "noor", serviceDate: "2026-11-22", status: "available" as const },
    { contactId: "noor", serviceDate: "2026-11-29", status: "available" as const },
    { contactId: "outsider", serviceDate: "2026-11-22", status: "available" as const },
  ];

  it("counts in, out, maybe, and no answer per team and date", () => {
    const [band, welcome] = aggregateAvailabilityGrid({ teams, dates: DATES, responses });
    expect(band.dates[0].counts).toEqual({ available: 2, unavailable: 1, maybe: 0, unanswered: 0 });
    expect(band.dates[1].counts).toEqual({ available: 1, unavailable: 0, maybe: 1, unanswered: 1 });
    expect(welcome.dates[0].counts).toEqual({ available: 1, unavailable: 0, maybe: 0, unanswered: 1 });
  });

  it("counts a leader who is also a member once", () => {
    const [team] = aggregateAvailabilityGrid({
      teams: [{ id: "band", name: "Sunday band", memberIds: ["sam"], leaderIds: ["sam"] }],
      dates: ["2026-11-22"],
      responses: [],
    });
    expect(teamRoster({ memberIds: ["sam"], leaderIds: ["sam"] })).toEqual(["sam"]);
    expect(team.dates[0].counts.unanswered).toBe(1);
  });

  it("counts the same person on each team they belong to", () => {
    const grid = aggregateAvailabilityGrid({ teams, dates: ["2026-11-22"], responses });
    const samTeams = grid.filter((team) => team.dates[0].counts.available > 0);
    expect(samTeams.map((team) => team.teamId).sort()).toEqual(["band", "welcome"]);
  });

  it("ignores a response for someone who is not on the team", () => {
    const [team] = aggregateAvailabilityGrid({
      teams: [{ id: "band", name: "Sunday band", memberIds: ["sam"], leaderIds: [] }],
      dates: ["2026-11-22"],
      responses: [{ contactId: "outsider", serviceDate: "2026-11-22", status: "available" }],
    });
    expect(team.dates[0].counts).toEqual({ available: 0, unavailable: 0, maybe: 0, unanswered: 1 });
  });
});

describe("unansweredContacts", () => {
  it("treats maybe as an answer and a missing date as silence", () => {
    expect(
      unansweredContacts({
        contactIds: ["sam", "noor", "sam"],
        dates: DATES,
        responses: [
          { contactId: "noor", serviceDate: "2026-11-22" },
          { contactId: "noor", serviceDate: "2026-11-29" },
          { contactId: "sam", serviceDate: "2026-11-22" },
        ],
      })
    ).toEqual(["sam"]);
  });
});
