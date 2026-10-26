import { describe, expect, it } from "vitest";
import {
  accessLabel,
  buildOutreachViewer,
  canEditGroups,
  canEditTeam,
  canManageGroupTeams,
  groupsOfTeam,
  resolveTeamAccess,
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

function viewerFor(world: World, who: string): OutreachViewer {
  const memberships = Object.entries(world.roster)
    .filter(([, people]) => people[who])
    .map(([team_id, people]) => ({ team_id, role: people[who] }));
  const managedGroupIds = Object.keys(world.managers).filter((g) => world.managers[g].includes(who));
  const staffEditor = world.staffEditors.has(who);
  const staffViewer = staffEditor || world.staffViewers.has(who);
  const leads = (team: string) => ["owner", "co_leader"].includes(world.roster[team]?.[who] ?? "");

  // RLS on outreach_group_teams ("Read group teams").
  const groupTeamLinks = Object.entries(world.groupTeams)
    .filter(([g, teams]) => staffViewer || managedGroupIds.includes(g) || teams.some(leads))
    .flatMap(([group_id, teams]) => teams.map((team_id) => ({ group_id, team_id })));

  return buildOutreachViewer({ staffViewer, staffEditor, memberships, managedGroupIds, groupTeamLinks });
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
  // A stand-in client answering the five reads the loader makes.
  function client(answers: {
    viewer?: boolean;
    editor?: boolean;
    memberships?: { team_id: string; role: string }[];
    managed?: string[] | "error";
    links?: { group_id: string; team_id: string }[] | "error";
  }) {
    const result = (data: unknown) => {
      const q = {
        select: () => q,
        eq: () => q,
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve(
            data === "error" ? { data: null, error: { message: "relation does not exist" } } : { data, error: null }
          ).then(res),
      };
      return q;
    };
    return {
      rpc: async (fn: string) => ({
        data: fn === "is_outreach_staff_editor" ? !!answers.editor : !!answers.viewer,
        error: null,
      }),
      from: (table: string) => {
        if (table === "outreach_team_members") return result(answers.memberships ?? []);
        if (table === "outreach_group_managers")
          return result(answers.managed === "error" ? "error" : (answers.managed ?? []).map((group_id) => ({ group_id })));
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
});
