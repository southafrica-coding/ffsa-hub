import { describe, expect, it } from "vitest";
import {
  buildServingIndex,
  matchInterestTeam,
  matchesServing,
  servingCounts,
  servingFor,
  type InterestRow,
  type RosterTeam,
} from "./serving";

// Structured rows only. Nothing here touches a database.

const SOUND = "00000000-0000-4000-8000-000000000001";
const WORSHIP = "00000000-0000-4000-8000-000000000002";
const KIDS = "00000000-0000-4000-8000-000000000003";
const PRODUCTION = "00000000-0000-4000-8000-000000000004";
const teams: RosterTeam[] = [
  { id: WORSHIP, name: "Worship" },
  { id: SOUND, name: "Sound" },
  { id: KIDS, name: "Kids" },
  { id: PRODUCTION, name: "Production" },
];

function interest(contactId: string | null, entries: unknown, status = "new"): InterestRow {
  return { contact_id: contactId, status, teams: entries };
}

describe("matchInterestTeam", () => {
  it("matches a real team id first", () => {
    expect(matchInterestTeam({ id: SOUND, name: "Something else" }, teams)?.name).toBe("Sound");
  });

  it("matches a name, trimmed and in any case", () => {
    expect(matchInterestTeam({ id: null, name: "  sOUnd " }, teams)?.id).toBe(SOUND);
  });

  it("maps the bot's fallback labels to starter teams", () => {
    expect(matchInterestTeam({ id: "worship", name: "Worship / band" }, teams)?.id).toBe(WORSHIP);
    expect(matchInterestTeam({ id: "production", name: "Production / tech" }, teams)?.id).toBe(PRODUCTION);
  });

  it("does not alias Prayer, Other, or free text, and ignores an unknown uuid", () => {
    expect(matchInterestTeam({ id: "prayer", name: "Prayer" }, teams)).toBeNull();
    expect(matchInterestTeam({ id: null, name: "Other" }, teams)).toBeNull();
    expect(matchInterestTeam({ id: null, name: "I can fix cars" }, teams)).toBeNull();
    expect(matchInterestTeam({ id: "00000000-0000-4000-8000-0000000000ff", name: "Nope" }, teams)).toBeNull();
    // An alias only works when the starter team exists.
    expect(matchInterestTeam({ id: "worship", name: "Worship / band" }, [])).toBeNull();
  });
});

describe("buildServingIndex", () => {
  it("shows one Leads chip when someone is a member and a leader of the same team", () => {
    const index = buildServingIndex({
      teams,
      members: [
        { team_id: KIDS, contact_id: "esther" },
        { team_id: WORSHIP, contact_id: "esther" },
      ],
      leaders: [{ team_id: KIDS, contact_id: "esther" }],
      interests: [],
    });
    expect(servingFor(index, "esther").teams).toEqual([
      { id: KIDS, name: "Kids", leads: true },
      { id: WORSHIP, name: "Worship", leads: false },
    ]);
  });

  it("counts a leader with no member row as serving", () => {
    const index = buildServingIndex({ teams, members: [], leaders: [{ team_id: SOUND, contact_id: "lila" }], interests: [] });
    expect(servingFor(index, "lila").teams).toEqual([{ id: SOUND, name: "Sound", leads: true }]);
  });

  it("only shows Interested for status new", () => {
    const index = buildServingIndex({
      teams,
      members: [],
      leaders: [],
      interests: [
        interest("a", [{ id: SOUND, name: "Sound" }], "new"),
        interest("b", [{ id: SOUND, name: "Sound" }], "contacted"),
        interest("c", [{ id: SOUND, name: "Sound" }], "placed"),
        interest("d", [{ id: SOUND, name: "Sound" }], "closed"),
        interest(null, [{ id: SOUND, name: "Sound" }], "new"),
      ],
    });
    expect(servingFor(index, "a").interestTeams).toEqual([{ name: "Sound", teamId: SOUND }]);
    for (const id of ["b", "c", "d"]) expect(servingFor(index, id).interestTeams).toEqual([]);
    expect(index.byContact.size).toBe(1);
  });

  it("drops Interested for a team they're already on, but keeps other teams", () => {
    const index = buildServingIndex({
      teams,
      members: [{ team_id: WORSHIP, contact_id: "johan" }],
      leaders: [],
      interests: [interest("johan", [{ id: "worship", name: "Worship / band" }, { id: SOUND, name: "Sound" }])],
    });
    expect(servingFor(index, "johan")).toEqual({
      teams: [{ id: WORSHIP, name: "Worship", leads: false }],
      interestTeams: [{ name: "Sound", teamId: SOUND }],
    });
  });

  it("keeps unmatched and Other interests by name, once each", () => {
    const index = buildServingIndex({
      teams,
      members: [],
      leaders: [],
      interests: [
        interest("riley", [{ id: "prayer", name: "Prayer" }, { id: null, name: "" }, { id: null, name: "prayer" }]),
        interest("riley", [{ id: SOUND, name: "Sound" }, "not an object", null]),
        interest("bad", "not an array"),
      ],
    });
    expect(servingFor(index, "riley").interestTeams).toEqual([
      { name: "Other", teamId: null },
      { name: "Prayer", teamId: null },
      { name: "Sound", teamId: SOUND },
    ]);
    expect(servingFor(index, "bad")).toEqual({ teams: [], interestTeams: [] });
  });

  it("ignores roster rows for a team that isn't this org's", () => {
    const index = buildServingIndex({
      teams,
      members: [{ team_id: "00000000-0000-4000-8000-0000000000ff", contact_id: "x" }],
      leaders: [],
      interests: [],
    });
    expect(servingFor(index, "x").teams).toEqual([]);
  });
});

describe("filters and counts", () => {
  const index = buildServingIndex({
    teams,
    members: [
      { team_id: WORSHIP, contact_id: "esther" },
      { team_id: SOUND, contact_id: "lila" },
    ],
    leaders: [{ team_id: KIDS, contact_id: "esther" }],
    interests: [interest("riley", [{ id: null, name: "Worship / band" }]), interest("lila", [{ id: null, name: "Kids" }])],
  });
  const everyone = ["esther", "lila", "riley", "sipho"];
  const pick = (filter: Parameters<typeof matchesServing>[2]) => everyone.filter((id) => matchesServing(index, id, filter));

  it("filters serves yes / no / interested and by team, ANDed", () => {
    expect(pick({})).toEqual(everyone);
    expect(pick({ serves: "yes" })).toEqual(["esther", "lila"]);
    // Interest alone isn't serving.
    expect(pick({ serves: "no" })).toEqual(["riley", "sipho"]);
    expect(pick({ serves: "interested" })).toEqual(["lila", "riley"]);
    expect(pick({ team: KIDS })).toEqual(["esther"]);
    expect(pick({ team: SOUND, serves: "interested" })).toEqual(["lila"]);
    expect(pick({ team: SOUND, serves: "no" })).toEqual([]);
  });

  it("counts every team, zeros included, A to Z", () => {
    expect(servingCounts(index, everyone)).toEqual({
      serves: 2,
      doesnt: 2,
      interested: 2,
      teams: [
        { id: KIDS, name: "Kids", count: 1 },
        { id: PRODUCTION, name: "Production", count: 0 },
        { id: SOUND, name: "Sound", count: 1 },
        { id: WORSHIP, name: "Worship", count: 1 },
      ],
    });
  });

  it("is honest with an empty roster: everyone doesn't serve", () => {
    const empty = buildServingIndex({ teams: [], members: [], leaders: [], interests: [] });
    expect(servingCounts(empty, everyone)).toEqual({ serves: 0, doesnt: 4, interested: 0, teams: [] });
  });
});
