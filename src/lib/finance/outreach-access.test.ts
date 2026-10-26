import { describe, expect, it } from "vitest";
import {
  accessLabel,
  buildOutreachViewer,
  canEditGroups,
  canEditTeam,
  canManageGroupTeams,
  groupsOfTeam,
  resolveTeamAccess,
  teamsVisibleTo,
  type OutreachViewer,
} from "./outreach-access";
import { loadOutreachViewer } from "./outreach-viewer";

// The three-layer outreach access model (migration 273), tested against a
// small world of teams, groups, rosters and managers.
//
//   Group NATIONS: teams kenya, nepal          managers: mia
//   Group YOUTH:   teams nepal, local          managers: max
//   Team  solo:    in no group
//
//   kenya: owner olu, co-leader cal, member mem
//   nepal: owner nia
//   local: co-leader lee
//   solo:  owner sol
//
// `viewerFor()` hands the resolver what loadOutreachViewer() would read for
// that person through RLS: staff see every group link, everyone else only
// the links of groups they manage or have a team they lead in.

type World = {
  groupTeams: Record<string, string[]>;
  managers: Record<string, string[]>;
  roster: Record<string, Record<string, string>>;
  staffViewers: Set<string>;
  staffEditors: Set<string>;
};

function freshWorld(): World {
  return {
    groupTeams: { nations: ["kenya", "nepal"], youth: ["nepal", "local"] },
    managers: { nations: ["mia"], youth: ["max"] },
    roster: {
      kenya: { olu: "owner", cal: "co_leader", mem: "team_member" },
      nepal: { nia: "owner" },
      local: { lee: "co_leader" },
      solo: { sol: "owner" },
    },
    staffViewers: new Set(["viewer"]),
    staffEditors: new Set(["sa", "fin"]),
  };
}

// `opts.limited` is the person's "limited to own teams" flag (migration
// 274); `opts.roleStaff` says their staff access comes from an admin tier
// or finance_admin rather than a finance.view / finance.edit grant. The
// staff flags are passed in as the pre-274 database would answer them, so
// these tests also check the app holds the line on its own.
function viewerFor(
  world: World,
  who: string,
  opts: { limited?: boolean; roleStaff?: boolean } = {}
): OutreachViewer {
  const memberships = Object.entries(world.roster)
    .filter(([, people]) => people[who])
    .map(([team_id, people]) => ({ team_id, role: people[who] }));
  const managedGroupIds = Object.keys(world.managers).filter((g) => world.managers[g].includes(who));
  const staffEditor = world.staffEditors.has(who);
  const staffViewer = staffEditor || world.staffViewers.has(who);
  const leads = (team: string) => ["owner", "co_leader"].includes(world.roster[team]?.[who] ?? "");

  // RLS on outreach_group_teams ("Read group teams"), with 274's staff rule.
  const rlsStaff = staffViewer && (!opts.limited || !!opts.roleStaff);
  const groupTeamLinks = Object.entries(world.groupTeams)
    .filter(([g, teams]) => rlsStaff || managedGroupIds.includes(g) || teams.some(leads))
    .flatMap(([group_id, teams]) => teams.map((team_id) => ({ group_id, team_id })));

  return buildOutreachViewer({
    staffViewer,
    staffEditor,
    memberships,
    managedGroupIds,
    groupTeamLinks,
    limitedToOwnTeams: opts.limited,
    roleStaff: opts.roleStaff,
  });
}

const access = (world: World, who: string, team: string) => resolveTeamAccess(viewerFor(world, who), team);

describe("team layer (unchanged)", () => {
  it("a plain member gets the money-free view of their own team only", () => {
    const w = freshWorld();
    expect(access(w, "mem", "kenya")).toEqual({ level: "member", via: "member" });
    expect(access(w, "mem", "nepal").level).toBeNull();
    expect(access(w, "mem", "solo").level).toBeNull();
  });

  it("owner and co-leader edit their own team", () => {
    const w = freshWorld();
    expect(access(w, "olu", "kenya")).toEqual({ level: "edit", via: "leader" });
    expect(access(w, "cal", "kenya")).toEqual({ level: "edit", via: "leader" });
  });

  it("a member is not a group peer: being on a team in a group shows them nothing else", () => {
    const w = freshWorld();
    expect(access(w, "mem", "nepal").level).toBeNull();
  });

  it("nobody sees a team they have no link to", () => {
    const w = freshWorld();
    expect(access(w, "stranger", "kenya").level).toBeNull();
    expect(access(w, "olu", "solo").level).toBeNull();
  });
});

describe("leaders see the other teams in their groups, read-only", () => {
  it("kenya's leaders read nepal (shared NATIONS group) but can't change it", () => {
    const w = freshWorld();
    for (const who of ["olu", "cal"]) {
      expect(access(w, who, "nepal")).toEqual({ level: "view", via: "group_peer" });
      expect(canEditTeam(viewerFor(w, who), "nepal")).toBe(false);
    }
  });

  it("only through groups their own team is in", () => {
    const w = freshWorld();
    // local is in YOUTH; kenya is not.
    expect(access(w, "olu", "local").level).toBeNull();
    // nepal is in both, so its owner reads kenya and local.
    expect(access(w, "nia", "kenya")).toEqual({ level: "view", via: "group_peer" });
    expect(access(w, "nia", "local")).toEqual({ level: "view", via: "group_peer" });
  });

  it("their own team stays editable even though it's in the group too", () => {
    const w = freshWorld();
    expect(access(w, "nia", "nepal")).toEqual({ level: "edit", via: "leader" });
  });

  it("the read-only label shows on peer teams", () => {
    const w = freshWorld();
    expect(accessLabel(access(w, "olu", "nepal"))).toBe("View only");
    expect(accessLabel(access(w, "olu", "kenya"))).toBeNull();
  });
});

describe("managers edit every team in the groups they manage", () => {
  it("mia edits kenya and nepal through NATIONS", () => {
    const w = freshWorld();
    expect(access(w, "mia", "kenya")).toEqual({ level: "edit", via: "manager" });
    expect(access(w, "mia", "nepal")).toEqual({ level: "edit", via: "manager" });
    expect(accessLabel(access(w, "mia", "kenya"))).toBe("Group manager");
  });

  it("but nothing outside them", () => {
    const w = freshWorld();
    expect(access(w, "mia", "local").level).toBeNull();
    expect(access(w, "mia", "solo").level).toBeNull();
  });

  it("manages teams in their own groups, and only those", () => {
    const w = freshWorld();
    const mia = viewerFor(w, "mia");
    expect(canManageGroupTeams(mia, "nations")).toBe(true);
    expect(canManageGroupTeams(mia, "youth")).toBe(false);
    expect(canEditGroups(mia)).toBe(false);
  });

  it("a team added to the group is theirs straight away", () => {
    const w = freshWorld();
    expect(access(w, "mia", "solo").level).toBeNull();
    w.groupTeams.nations.push("solo");
    expect(access(w, "mia", "solo")).toEqual({ level: "edit", via: "manager" });
  });
});

describe("a team in more than one group", () => {
  it("nepal is in NATIONS and YOUTH: both groups' managers edit it", () => {
    const w = freshWorld();
    expect(access(w, "mia", "nepal")).toEqual({ level: "edit", via: "manager" });
    expect(access(w, "max", "nepal")).toEqual({ level: "edit", via: "manager" });
    expect(groupsOfTeam(viewerFor(w, "sa"), "nepal").sort()).toEqual(["nations", "youth"]);
  });

  it("taking it out of one group leaves the other group's manager in place", () => {
    const w = freshWorld();
    w.groupTeams.youth = w.groupTeams.youth.filter((t) => t !== "nepal");
    expect(access(w, "max", "nepal").level).toBeNull();
    expect(access(w, "mia", "nepal")).toEqual({ level: "edit", via: "manager" });
  });
});

describe("a team taken out of a group", () => {
  it("is gone from that group's manager", () => {
    const w = freshWorld();
    expect(access(w, "mia", "kenya").level).toBe("edit");
    w.groupTeams.nations = w.groupTeams.nations.filter((t) => t !== "kenya");
    expect(access(w, "mia", "kenya").level).toBeNull();
  });

  it("is gone from the other teams' leaders in that group", () => {
    const w = freshWorld();
    expect(access(w, "nia", "kenya").level).toBe("view");
    w.groupTeams.nations = w.groupTeams.nations.filter((t) => t !== "kenya");
    expect(access(w, "nia", "kenya").level).toBeNull();
  });

  it("keeps its own roster's access", () => {
    const w = freshWorld();
    w.groupTeams.nations = w.groupTeams.nations.filter((t) => t !== "kenya");
    expect(access(w, "olu", "kenya").level).toBe("edit");
    expect(access(w, "mem", "kenya").level).toBe("member");
  });

  it("and a manager taken off the group loses its teams", () => {
    const w = freshWorld();
    w.managers.nations = [];
    expect(access(w, "mia", "kenya").level).toBeNull();
  });
});

describe("admins and finance staff keep everything", () => {
  it.each(["sa", "fin"])("%s edits every team, grouped or not", (who) => {
    const w = freshWorld();
    for (const team of ["kenya", "nepal", "local", "solo"]) {
      expect(access(w, who, team)).toEqual({ level: "edit", via: "staff" });
    }
    expect(canEditGroups(viewerFor(w, who))).toBe(true);
    expect(canManageGroupTeams(viewerFor(w, who), "youth")).toBe(true);
  });

  it("a finance.view reader still reads every team, without editing", () => {
    const w = freshWorld();
    for (const team of ["kenya", "nepal", "local", "solo"]) {
      expect(access(w, "viewer", team)).toEqual({ level: "view", via: "staff" });
    }
    expect(canEditGroups(viewerFor(w, "viewer"))).toBe(false);
  });

  it("staff access doesn't depend on groups at all", () => {
    const w = freshWorld();
    w.groupTeams = {};
    w.managers = {};
    expect(access(w, "fin", "kenya").level).toBe("edit");
    expect(access(w, "viewer", "kenya").level).toBe("view");
  });

  it("a leader who is also a finance viewer still edits their own team", () => {
    const w = freshWorld();
    w.staffViewers.add("olu");
    expect(access(w, "olu", "kenya")).toEqual({ level: "edit", via: "leader" });
    expect(access(w, "olu", "solo")).toEqual({ level: "view", via: "staff" });
  });
});

describe("loadOutreachViewer", () => {
  // A stand-in client answering the reads the loader makes.
  function client(answers: {
    viewer?: boolean;
    editor?: boolean;
    memberships?: { team_id: string; role: string }[];
    managed?: string[] | "error";
    links?: { group_id: string; team_id: string }[] | "error";
    /** The caller's own outreach_user_restrictions row (migration 274). */
    limited?: boolean | "error";
    isAdmin?: boolean;
    financeAdmin?: boolean;
  }) {
    const result = (data: unknown) => {
      const settle = () =>
        Promise.resolve(
          data === "error" ? { data: null, error: { message: "relation does not exist" } } : { data, error: null }
        );
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: settle,
        then: (res: (v: unknown) => unknown) => settle().then(res),
      };
      return q;
    };
    return {
      rpc: async (fn: string) => {
        const answer: Record<string, boolean> = {
          is_outreach_staff_editor: !!answers.editor,
          is_outreach_staff_viewer: !!answers.viewer,
          is_admin: !!answers.isAdmin,
          has_role: !!answers.financeAdmin,
        };
        return { data: answer[fn] ?? false, error: null };
      },
      from: (table: string) => {
        if (table === "outreach_team_members") return result(answers.memberships ?? []);
        if (table === "outreach_group_managers")
          return result(answers.managed === "error" ? "error" : (answers.managed ?? []).map((group_id) => ({ group_id })));
        if (table === "outreach_user_restrictions")
          return result(
            answers.limited === "error"
              ? "error"
              : answers.limited === undefined
                ? null
                : { user_id: "me", limited_to_own_teams: answers.limited }
          );
        return result(answers.links ?? []);
      },
    };
  }

  it("builds the viewer from fresh reads", async () => {
    const v = await loadOutreachViewer(
      client({
        managed: ["nations"],
        links: [
          { group_id: "nations", team_id: "kenya" },
          { group_id: "nations", team_id: "nepal" },
        ],
      }),
      "mia"
    );
    expect(resolveTeamAccess(v, "kenya")).toEqual({ level: "edit", via: "manager" });
  });

  it("grants nothing extra when the group tables can't be read", async () => {
    // e.g. the app deployed before migration 273 is applied.
    const v = await loadOutreachViewer(
      client({ memberships: [{ team_id: "kenya", role: "owner" }], managed: "error", links: "error" }),
      "olu"
    );
    expect(v.managedGroupIds).toEqual([]);
    expect(resolveTeamAccess(v, "kenya").level).toBe("edit");
    expect(resolveTeamAccess(v, "nepal").level).toBeNull();
  });

  it("an editor counts as a viewer too", async () => {
    const v = await loadOutreachViewer(client({ editor: true }), "fin");
    expect(v.staffViewer).toBe(true);
    expect(v.staffEditor).toBe(true);
  });

  it("a flagged finance.edit holder is not staff, even if the database still says so", async () => {
    // e.g. the app deployed before migration 274 is applied to the helpers.
    const v = await loadOutreachViewer(
      client({
        viewer: true,
        editor: true,
        limited: true,
        memberships: [{ team_id: "botswana", role: "co_leader" }],
      }),
      "stefan"
    );
    expect(v.limitedToOwnTeams).toBe(true);
    expect(v.staffViewer).toBe(false);
    expect(v.staffEditor).toBe(false);
    expect(resolveTeamAccess(v, "botswana")).toEqual({ level: "edit", via: "leader" });
    expect(resolveTeamAccess(v, "kenya").level).toBeNull();
  });

  it("a flagged admin or finance_admin keeps staff access", async () => {
    for (const role of [{ isAdmin: true }, { financeAdmin: true }]) {
      const v = await loadOutreachViewer(client({ viewer: true, editor: true, limited: true, ...role }), "x");
      expect(v.staffEditor).toBe(true);
      expect(v.staffViewer).toBe(true);
    }
  });

  it("the flag switched off, or unreadable, changes nothing", async () => {
    for (const limited of [false, "error" as const]) {
      const v = await loadOutreachViewer(client({ viewer: true, limited }), "viewer");
      expect(v.limitedToOwnTeams).toBe(false);
      expect(v.staffViewer).toBe(true);
    }
  });
});

describe("outreach limited to own teams (migration 274)", () => {
  // stefan holds finance.view and finance.edit and co-leads botswana, which
  // sits in NATIONS. With the flag on he is outreach staff no longer.
  function stefanWorld(opts: { limited: boolean; manages?: string[] }) {
    const w = freshWorld();
    w.roster.botswana = { stefan: "co_leader" };
    w.groupTeams.nations.push("botswana");
    w.staffEditors.add("stefan");
    for (const g of opts.manages ?? []) w.managers[g].push("stefan");
    return { w, v: () => viewerFor(w, "stefan", { limited: opts.limited }) };
  }

  const ALL = ["kenya", "nepal", "local", "solo", "botswana"].map((id) => ({ id }));

  it("a restricted finance.view / finance.edit holder sees only their own team", () => {
    const { w } = stefanWorld({ limited: true });
    w.groupTeams.nations = w.groupTeams.nations.filter((t) => t !== "botswana");
    const v = viewerFor(w, "stefan", { limited: true });
    expect(v.staffViewer).toBe(false);
    expect(v.staffEditor).toBe(false);
    expect(resolveTeamAccess(v, "botswana")).toEqual({ level: "edit", via: "leader" });
    for (const team of ["kenya", "nepal", "local", "solo"]) {
      expect(resolveTeamAccess(v, team).level).toBeNull();
    }
    expect(teamsVisibleTo(v, ALL).map((t) => t.id)).toEqual(["botswana"]);
  });

  it("keeps the read-only view of other teams in his own team's groups", () => {
    const { v } = stefanWorld({ limited: true });
    expect(resolveTeamAccess(v(), "kenya")).toEqual({ level: "view", via: "group_peer" });
    expect(resolveTeamAccess(v(), "local").level).toBeNull();
    expect(teamsVisibleTo(v(), ALL).map((t) => t.id).sort()).toEqual(["botswana", "kenya", "nepal"]);
  });

  it("still edits every team in the groups he manages", () => {
    const { v } = stefanWorld({ limited: true, manages: ["youth"] });
    expect(resolveTeamAccess(v(), "local")).toEqual({ level: "edit", via: "manager" });
    expect(resolveTeamAccess(v(), "nepal")).toEqual({ level: "edit", via: "manager" });
    expect(resolveTeamAccess(v(), "solo").level).toBeNull();
    expect(canManageGroupTeams(v(), "youth")).toBe(true);
    expect(canManageGroupTeams(v(), "nations")).toBe(false);
  });

  it("loses the administrator-only group powers his finance.edit gave him", () => {
    const { v } = stefanWorld({ limited: true });
    expect(canEditGroups(v())).toBe(false);
  });

  it("without the flag the same person still sees and edits every team", () => {
    const { v } = stefanWorld({ limited: false });
    for (const team of ["kenya", "nepal", "local", "solo", "botswana"]) {
      expect(resolveTeamAccess(v(), team).level).toBe("edit");
    }
    expect(teamsVisibleTo(v(), ALL)).toEqual(ALL);
  });

  it("an unrestricted finance.view reader still sees every team", () => {
    const w = freshWorld();
    const v = viewerFor(w, "viewer");
    expect(v.limitedToOwnTeams).toBe(false);
    for (const team of ["kenya", "nepal", "local", "solo"]) {
      expect(resolveTeamAccess(v, team)).toEqual({ level: "view", via: "staff" });
    }
    expect(teamsVisibleTo(v, ALL)).toEqual(ALL);
  });

  it("a restricted finance.view reader with no team sees nothing", () => {
    const w = freshWorld();
    const v = viewerFor(w, "viewer", { limited: true });
    expect(teamsVisibleTo(v, ALL)).toEqual([]);
  });

  it("does not limit an admin or finance_admin", () => {
    const w = freshWorld();
    const v = viewerFor(w, "sa", { limited: true, roleStaff: true });
    expect(v.staffEditor).toBe(true);
    expect(teamsVisibleTo(v, ALL)).toEqual(ALL);
  });
});
