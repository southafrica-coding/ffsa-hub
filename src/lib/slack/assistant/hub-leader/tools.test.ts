import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeState } from "./testing";
import type { HubState } from "./testing-hub";

const h = vi.hoisted(() => ({ state: {} as FakeState, hub: {} as HubState, posts: [] as unknown[] }));

vi.mock("./data", async () => (await import("./testing")).makeFakeData(h.state));
vi.mock("./hub-data", async () => (await import("./testing-hub")).makeFakeHub(h.hub));
vi.mock("@/lib/slack/client", () => ({
  postMessage: async (args: unknown) => {
    h.posts.push(args);
    return { ok: true };
  },
}));

const { baseState, MINISTRY_WORSHIP } = await import("./testing");
const { executeHubLeaderTool } = await import("./tools");
const { checkPermissionChange, matchPerson, mergeMembers, NOT_IN_TEAM, resolveLeader } = await import("./rules");

const leader = { hubUserId: "u-lead", slackUserId: "U_LEAD", ministries: [{ id: MINISTRY_WORSHIP, name: "Worship" }], pointLeaderOf: [] };
const ctx = () => ({ admin: {}, leader, channelId: "D_LEAD" });
const run = (name: string, input: Record<string, unknown> = {}) => executeHubLeaderTool(ctx(), name, input);
const saved = { ...process.env };

beforeEach(async () => {
  for (const k of Object.keys(h.state)) delete (h.state as Record<string, unknown>)[k];
  Object.assign(h.state, baseState());
  for (const k of Object.keys(h.hub)) delete (h.hub as Record<string, unknown>)[k];
  Object.assign(h.hub, (await import("./testing-hub")).baseHubState());
  h.posts.length = 0;
  delete process.env.SLACK_ASSISTANT_TICKET_CHANNEL_ID;
});
afterEach(() => {
  process.env = { ...saved };
});

describe("who may use it", () => {
  it("refuses an unlinked Slack user", async () => {
    expect(await resolveLeader({}, "U_NOBODY", async () => null)).toEqual({ kind: "unlinked" });
  });

  it("refuses a Hub user who leads no ministry, even if they're a member", async () => {
    expect(await resolveLeader({}, "U_AMY", async () => "u-amy")).toEqual({ kind: "not_leader", hubUserId: "u-amy" });
  });

  it("does not count a pending leader membership", async () => {
    h.state.memberships.push({ user_id: "u-plain", ministry_id: MINISTRY_WORSHIP, member_role: "leader", status: "pending" });
    expect((await resolveLeader({}, "U_PLAIN", async () => "u-plain")).kind).toBe("not_leader");
  });

  it("accepts an active leader with the ministries they lead", async () => {
    const r = await resolveLeader({}, "U_LEAD", async () => "u-lead");
    expect(r).toEqual({ kind: "leader", leader });
  });

  it("stops working mid-conversation once they no longer lead", async () => {
    h.state.memberships = h.state.memberships.filter((m) => m.member_role !== "leader");
    const out = await run("list_team_access");
    expect(out.output).toEqual({ error: "Sorry, this assistant is only available to ministry leaders." });
  });
});

describe("list_team_access", () => {
  it("lists only active members of the led ministries, with their access", async () => {
    const out = (await run("list_team_access")).output as {
      ministries: { ministry: string; people: { name: string; permissions: { key: string }[]; from_roles: string[]; roles: string[] }[] }[];
    };
    expect(out.ministries).toHaveLength(1);
    expect(out.ministries[0].ministry).toBe("Worship");
    const names = out.ministries[0].people.map((p) => p.name);
    expect(names).toEqual(["Amy Adams", "Ben Brown", "Lee Leader"]);
    expect(names).not.toContain("Olive Outsider");
    expect(names).not.toContain("Pat Pending");
    const ben = out.ministries[0].people.find((p) => p.name === "Ben Brown")!;
    expect(ben.permissions.map((p) => p.key)).toEqual(["events.view"]);
    expect(ben.from_roles).toEqual(["bookings.request"]);
    expect(ben.roles).toEqual(["staff"]);
  });

  it("hides legacy duplicate permission keys", async () => {
    h.state.permissions.push({ id: "p-cv", key: "contacts.view", display_name: "View contacts (old)", module: "contacts" });
    h.state.direct.push({ user_id: "u-amy", key: "contacts.view", scope_type: null, scope_id: null });
    const out = (await run("list_team_access")).output as { ministries: { people: { name: string; permissions: { key: string }[] }[] }[] };
    const amy = out.ministries[0].people.find((p) => p.name === "Amy Adams")!;
    expect(amy.permissions).toEqual([]);
  });
});

describe("team access — scoped grants outside the leader's reach", () => {
  // The leader (u-lead) holds schools.view for program prog-1 only.
  const amyIn = async (name: string, input: Record<string, unknown>) => {
    const out = (await run(name, input)).output as Record<string, unknown>;
    if (name === "lookup_person_access") return out as { permissions: Record<string, unknown>[] };
    const people = (out as { ministries: { people: { name: string; permissions: Record<string, unknown>[] }[] }[] }).ministries[0].people;
    return people.find((p) => p.name === "Amy Adams")!;
  };

  beforeEach(() => {
    h.state.direct.push(
      { user_id: "u-amy", key: "schools.view", scope_type: "program", scope_id: "prog-1" }, // the leader's own scope
      { user_id: "u-amy", key: "schools.view", scope_type: "program", scope_id: "prog-2" }, // a school the leader isn't in
      { user_id: "u-amy", key: "events.view", scope_type: "team", scope_id: "team-9" }, // an outreach team the leader isn't in
      { user_id: "u-amy", key: "finance.view", scope_type: null, scope_id: null } // everywhere
    );
  });

  for (const tool of ["list_team_access", "lookup_person_access"]) {
    it(`${tool}: shows everywhere grants and the leader's own scopes, and nothing of the others`, async () => {
      const amy = await amyIn(tool, { person: "Amy" });
      expect(amy.permissions).toEqual([
        expect.objectContaining({ key: "schools.view", scope: "program: DTS Spring", scope_id: "prog-1" }),
        expect.objectContaining({ key: "finance.view", scope: "everywhere", scope_id: null }),
      ]);
      const shown = JSON.stringify(amy);
      for (const leak of ["prog-2", "SBS Winter", "team-9", "Nepal team"]) expect(shown).not.toContain(leak);
      // The out-of-scope ids are never even looked up.
      expect(h.state.labelRequests).not.toContain("program:prog-2");
      expect(h.state.labelRequests).not.toContain("team:team-9");
    });
  }

  it("shows a scope once the leader holds a grant there too", async () => {
    h.state.direct.push({ user_id: "u-lead", key: "events.view", scope_type: "team", scope_id: "team-9" });
    const amy = await amyIn("lookup_person_access", { person: "Amy" });
    expect(amy.permissions).toContainEqual(expect.objectContaining({ key: "events.view", scope: "team: Nepal team" }));
    expect(JSON.stringify(amy)).not.toContain("prog-2");
  });

  it("still hides legacy keys, scoped or not", async () => {
    h.state.permissions.push({ id: "p-cv", key: "contacts.view", display_name: "View contacts (old)", module: "contacts" });
    h.state.direct.push({ user_id: "u-amy", key: "contacts.view", scope_type: "program", scope_id: "prog-1" });
    const amy = await amyIn("lookup_person_access", { person: "Amy" });
    expect(amy.permissions.map((p) => p.key)).not.toContain("contacts.view");
  });
});

describe("lookup_person_access", () => {
  it("finds a team member by part of their name", async () => {
    const out = (await run("lookup_person_access", { person: "ben" })).output as { name: string };
    expect(out.name).toBe("Ben Brown");
  });

  it("finds a team member by email", async () => {
    const out = (await run("lookup_person_access", { person: "AMY@example.test" })).output as { name: string };
    expect(out.name).toBe("Amy Adams");
  });

  it("does not reveal someone outside the led ministries", async () => {
    const byName = await run("lookup_person_access", { person: "Olive Outsider" });
    const byEmail = await run("lookup_person_access", { person: "olive@example.test" });
    const byId = await run("lookup_person_access", { user_id: "u-out" });
    const nobody = await run("lookup_person_access", { person: "Zed Nobody" });
    for (const r of [byName, byEmail, byId]) expect(r.output).toEqual(nobody.output);
    expect(nobody.output).toEqual({ error: NOT_IN_TEAM });
  });

  it("asks rather than guesses when several match", async () => {
    h.state.users.push({ id: "u-amy2", first_name: "Amy", last_name: "Archer", email: "archer@example.test" });
    h.state.memberships.push({ user_id: "u-amy2", ministry_id: MINISTRY_WORSHIP, member_role: "member", status: "active" });
    const out = (await run("lookup_person_access", { person: "amy" })).output as { needs_clarification: boolean; candidates: { user_id: string }[] };
    expect(out.needs_clarification).toBe(true);
    expect(out.candidates.map((c) => c.user_id).sort()).toEqual(["u-amy", "u-amy2"]);
    const picked = (await run("lookup_person_access", { user_id: "u-amy2" })).output as { name: string };
    expect(picked.name).toBe("Amy Archer");
  });
});

describe("grant_permission / revoke_permission", () => {
  const refusal = async (name: string, input: Record<string, unknown>) => {
    const out = await run(name, input);
    expect(out.proposal).toBeUndefined();
    expect(h.state.pending).toHaveLength(0);
    return (out.output as { refused?: boolean; reason?: string; error?: string });
  };

  it("proposes a grant the leader holds, without writing it", async () => {
    const out = await run("grant_permission", { person: "Amy", permission_key: "events.view" });
    expect(out.proposal?.summary).toContain("Amy Adams");
    expect(out.output).toMatchObject({ awaiting_confirmation: true });
    expect(h.state.pending).toHaveLength(1);
    expect(h.state.pending[0]).toMatchObject({
      leader_hub_user_id: "u-lead",
      slack_user_id: "U_LEAD",
      action_type: "grant_permission",
      payload: { target_user_id: "u-amy", permission_key: "events.view", scope_type: null, scope_id: null },
    });
    expect(h.state.grants).toHaveLength(0);
    expect(h.state.audit.map((a) => a.result)).toEqual(["proposed"]);
  });

  it("accepts a permission the leader holds through their role", async () => {
    const out = await run("grant_permission", { person: "Amy", permission_key: "bookings.request" });
    expect(out.proposal).toBeDefined();
  });

  it("refuses a permission the leader doesn't hold", async () => {
    const r = await refusal("grant_permission", { person: "Amy", permission_key: "finance.view" });
    expect(r.reason).toMatch(/don't hold `finance.view`/);
  });

  it("refuses someone outside the team, without saying they exist", async () => {
    const r = await refusal("grant_permission", { person: "Olive", permission_key: "events.view" });
    expect(r).toEqual({ error: NOT_IN_TEAM });
  });

  it("refuses super-admin-only and admin keys even when the leader holds them", async () => {
    expect((await refusal("grant_permission", { person: "Amy", permission_key: "records_library.manage" })).reason).toMatch(/can't hand out/);
    expect((await refusal("grant_permission", { person: "Amy", permission_key: "administration.manage_roles" })).reason).toMatch(/can't hand out/);
  });

  it("refuses roles", async () => {
    for (const key of ["admin", "super_admin", "comms_admin"]) {
      expect((await refusal("grant_permission", { person: "Amy", permission_key: key })).reason).toMatch(/can't change roles/);
    }
  });

  it("refuses changing the leader's own access", async () => {
    const r = await refusal("grant_permission", { person: "Lee", permission_key: "events.view" });
    expect(r.reason).toMatch(/your own access/);
  });

  it("refuses changing an admin's access", async () => {
    h.state.users.find((u) => u.id === "u-amy")!.admin = true;
    const r = await refusal("grant_permission", { person: "Amy", permission_key: "events.view" });
    expect(r.reason).toMatch(/Hub admin/);
  });

  it("only allows a scope the leader holds", async () => {
    const ok = await run("grant_permission", { person: "Amy", permission_key: "schools.view", scope_type: "program", scope_id: "prog-1" });
    expect(ok.proposal).toBeDefined();
    h.state.pending.length = 0;
    const other = await refusal("grant_permission", { person: "Amy", permission_key: "schools.view", scope_type: "program", scope_id: "prog-2" });
    expect(other.reason).toMatch(/for that program/);
    const everywhere = await refusal("grant_permission", { person: "Amy", permission_key: "schools.view" });
    expect(everywhere.reason).toMatch(/specific scopes/);
    const half = await refusal("grant_permission", { person: "Amy", permission_key: "schools.view", scope_type: "program" });
    expect(half.reason).toMatch(/scope/);
  });

  it("won't grant what the person already has", async () => {
    const r = await refusal("grant_permission", { person: "Ben", permission_key: "events.view" });
    expect(r.reason).toMatch(/already has/);
  });

  it("proposes revoking a direct grant", async () => {
    const out = await run("revoke_permission", { person: "Ben", permission_key: "events.view" });
    expect(out.proposal?.summary).toContain("Remove");
    expect(h.state.pending[0].action_type).toBe("revoke_permission");
    expect(h.state.revokes).toHaveLength(0);
  });

  it("won't revoke a permission that comes from a role", async () => {
    const r = await refusal("revoke_permission", { person: "Ben", permission_key: "bookings.request" });
    expect(r.reason).toMatch(/from their role/);
  });

  it("refuses a revoke of a key the leader doesn't hold", async () => {
    h.state.direct.push({ user_id: "u-ben", key: "finance.view", scope_type: null, scope_id: null });
    const r = await refusal("revoke_permission", { person: "Ben", permission_key: "finance.view" });
    expect(r.reason).toMatch(/don't hold/);
  });
});

describe("checkPermissionChange", () => {
  it("only takes people on the team by user id", async () => {
    const r = await checkPermissionChange({}, leader, {
      action: "grant",
      targetUserId: "u-out",
      permissionKey: "events.view",
      scopeType: null,
      scopeId: null,
    });
    expect(r).toEqual({ ok: false, reason: NOT_IN_TEAM });
  });
});

describe("resend_invite", () => {
  it("proposes a resend for a team member without a password", async () => {
    const out = await run("resend_invite", { person: "Amy" });
    expect(out.proposal?.summary).toContain("amy@example.test");
    expect(h.state.pending[0]).toMatchObject({ action_type: "resend_invite", payload: { target_user_id: "u-amy" } });
  });

  it("refuses someone who already has a password", async () => {
    const out = await run("resend_invite", { person: "Ben" });
    expect(out.proposal).toBeUndefined();
    expect((out.output as { reason: string }).reason).toMatch(/already finished/);
  });

  it("refuses someone outside the team", async () => {
    const out = await run("resend_invite", { person: "Olive" });
    expect(out.output).toEqual({ error: NOT_IN_TEAM });
    expect(h.state.pending).toHaveLength(0);
  });

  it("refuses someone with no email", async () => {
    h.state.users.find((u) => u.id === "u-amy")!.email = null;
    const out = await run("resend_invite", { user_id: "u-amy" });
    expect((out.output as { reason: string }).reason).toMatch(/no email/);
  });
});

describe("report_problem", () => {
  it("only proposes: no ticket, no audit_logs row, no Slack post until the button", async () => {
    process.env.SLACK_ASSISTANT_TICKET_CHANNEL_ID = "C_TICKETS";
    const out = await run("report_problem", { message: "The bookings page won't load" });
    expect(out.output).toMatchObject({ awaiting_confirmation: true, findings: [], could_not_check: [expect.stringMatching(/error logs/)] });
    expect(out.proposal).toMatchObject({ confirmLabel: "File report", summary: expect.stringContaining("The bookings page won't load") });
    expect(h.state.pending).toHaveLength(1);
    expect(h.state.pending[0]).toMatchObject({
      action_type: "report_problem",
      slack_user_id: "U_LEAD",
      payload: { message: "The bookings page won't load", evidence: expect.objectContaining({ findings: [] }) },
    });
    expect(h.state.tickets).toHaveLength(0);
    expect(h.state.hubAudit).toHaveLength(0);
    expect(h.posts).toHaveLength(0);
  });

  it("escapes the leader's text in the button message", async () => {
    const out = await run("report_problem", { message: "<!channel> look at <https://x.test|this>" });
    expect(out.proposal!.summary).not.toMatch(/<!channel>|<https/);
  });

  it("needs a message", async () => {
    expect((await run("report_problem", { message: "  " })).output).toMatchObject({ error: expect.any(String) });
    expect(h.state.tickets).toHaveLength(0);
    expect(h.state.pending).toHaveLength(0);
  });
});

describe("unknown tools", () => {
  it("refuses anything outside the allowlist", async () => {
    expect((await run("run_readonly_query", { sql: "select 1" })).output).toEqual({ error: "That isn't something I can do." });
  });
});

describe("matchPerson", () => {
  const team = mergeMembers([
    { user_id: "a", ministry_id: "m1", ministry_name: "One", member_role: "member", first_name: "Sam", last_name: "Smith", email: "s@x.test" },
    { user_id: "a", ministry_id: "m2", ministry_name: "Two", member_role: "member", first_name: "Sam", last_name: "Smith", email: "s@x.test" },
  ]);
  it("merges one person across ministries", () => {
    expect(team).toHaveLength(1);
    expect(team[0].ministries).toEqual(["One", "Two"]);
    expect(matchPerson(team, { person: "sam smith" })).toMatchObject({ kind: "ok" });
    expect(matchPerson(team, { person: "" })).toEqual({ kind: "not_found" });
  });
});
