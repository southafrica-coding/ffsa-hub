import { describe, expect, it } from "vitest";
import {
  callerCanAmendCheckin,
  callerCanCreateOkr,
  callerCanEditKeyResult,
  callerCanEditMinistryOkrs,
  callerCanEditObjective,
  callerCanManageCycles,
  canAmendCheckin,
  canChangeOkr,
  type OkrCaller,
} from "./check-okr-access";

// ────────────────────────────────────────────────────────────
// The pure rule
// ────────────────────────────────────────────────────────────

const WORSHIP = "ministry-worship";
const MEDIA = "ministry-media";

const admin: OkrCaller = { userId: "admin", isAdmin: true, ledMinistryIds: [] };
const worshipLeader: OkrCaller = { userId: "wl", isAdmin: false, ledMinistryIds: [WORSHIP] };
// The case from testing: on the Leadership Team, leads nothing (or a
// different ministry). The rule takes no leadership input at all — that is
// the point — so this caller is just "not admin, leads Media".
const leadershipMember: OkrCaller = { userId: "lt", isAdmin: false, ledMinistryIds: [MEDIA] };
const staff: OkrCaller = { userId: "staff", isAdmin: false, ledMinistryIds: [] };

const worshipObjective = { scope: "ministry", ministryId: WORSHIP, ownerUserId: null };
const teamObjective = { scope: "ministry", ministryId: null, ownerUserId: null };
const staffPersonal = { scope: "individual", ministryId: WORSHIP, ownerUserId: "staff" };

describe("canChangeOkr", () => {
  it("lets an admin change any objective, including an OKR team's", () => {
    expect(canChangeOkr(admin, worshipObjective)).toBe(true);
    expect(canChangeOkr(admin, teamObjective)).toBe(true);
    expect(canChangeOkr(admin, staffPersonal)).toBe(true);
  });

  it("lets a ministry leader change their own ministry's objectives", () => {
    expect(canChangeOkr(worshipLeader, worshipObjective)).toBe(true);
  });

  it("refuses a leader of another ministry — the Leadership Team bug", () => {
    expect(canChangeOkr(leadershipMember, worshipObjective)).toBe(false);
  });

  it("refuses ordinary staff on a ministry objective", () => {
    expect(canChangeOkr(staff, worshipObjective)).toBe(false);
  });

  it("keeps OKR-only teams (no ministry) admin-only", () => {
    expect(canChangeOkr(worshipLeader, teamObjective)).toBe(false);
    expect(canChangeOkr(leadershipMember, teamObjective)).toBe(false);
  });

  it("lets the owner change their own individual objective", () => {
    expect(canChangeOkr(staff, staffPersonal)).toBe(true);
  });

  it("lets the owner's ministry leader change it, and nobody else", () => {
    expect(canChangeOkr(worshipLeader, staffPersonal)).toBe(true);
    expect(canChangeOkr(leadershipMember, staffPersonal)).toBe(false);
  });

  it("does not treat ownership as a grant on a ministry-scoped objective", () => {
    expect(
      canChangeOkr(staff, { scope: "ministry", ministryId: MEDIA, ownerUserId: "staff" })
    ).toBe(false);
  });

  it("does not let a missing owner match a caller", () => {
    expect(
      canChangeOkr({ ...staff, userId: "" }, { scope: "individual", ministryId: MEDIA, ownerUserId: null })
    ).toBe(false);
  });
});

describe("canAmendCheckin", () => {
  it("lets the author amend their own check-in", () => {
    expect(canAmendCheckin(staff, "staff")).toBe(true);
  });

  it("lets an admin amend anyone's", () => {
    expect(canAmendCheckin(admin, "staff")).toBe(true);
  });

  it("refuses everyone else, leaders included", () => {
    expect(canAmendCheckin(worshipLeader, "staff")).toBe(false);
    expect(canAmendCheckin(leadershipMember, "staff")).toBe(false);
    expect(canAmendCheckin(staff, null)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// The database-backed wrappers, over a fake client
// ────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

// A PostgREST-shaped reader over fixed tables. Understands the filters these
// helpers use: eq, in, limit, maybeSingle, and awaiting the query directly.
function fakeClient(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = tables[table] ?? [];
      const q = {
        select: () => q,
        limit: () => q,
        eq: (col: string, v: unknown) => {
          rows = rows.filter((r) => r[col] === v);
          return q;
        },
        in: (col: string, vs: unknown[]) => {
          rows = rows.filter((r) => vs.includes(r[col]));
          return q;
        },
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (resolve: (r: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return q;
    },
  };
}

const role = (user_id: string, name: string) => ({ user_id, "roles.name": name });
const leads = (user_id: string, staff_ministry_id: string, status = "active") => ({
  user_id,
  staff_ministry_id,
  member_role: "leader",
  status,
});

const db = fakeClient({
  user_roles: [
    role("super", "super_admin"),
    role("general", "admin"),
    role("lt", "leadership_team"),
    role("lt", "staff"),
    role("wl", "staff"),
  ],
  staff_ministry_members: [
    leads("wl", WORSHIP),
    leads("lt", MEDIA),
    leads("former", WORSHIP, "inactive"),
    { user_id: "member", staff_ministry_id: WORSHIP, member_role: "member", status: "active" },
  ],
  okr_objectives: [
    { id: "obj-worship", scope: "ministry", staff_ministry_id: WORSHIP, owner_user_id: null },
    { id: "obj-media", scope: "ministry", staff_ministry_id: MEDIA, owner_user_id: null },
    { id: "obj-personal", scope: "individual", staff_ministry_id: WORSHIP, owner_user_id: "member" },
  ],
  okr_key_results: [{ id: "kr-worship", objective_id: "obj-worship" }],
  okr_checkins: [{ id: "ci-1", author_id: "wl" }],
});

describe("callerCanEditMinistryOkrs", () => {
  it("allows super admins and general admins on every ministry", async () => {
    expect(await callerCanEditMinistryOkrs(db, "super", WORSHIP)).toBe(true);
    expect(await callerCanEditMinistryOkrs(db, "general", WORSHIP)).toBe(true);
    expect(await callerCanEditMinistryOkrs(db, "general", null)).toBe(true);
  });

  it("allows an active leader on their own ministry only", async () => {
    expect(await callerCanEditMinistryOkrs(db, "wl", WORSHIP)).toBe(true);
    expect(await callerCanEditMinistryOkrs(db, "wl", MEDIA)).toBe(false);
  });

  it("does not let the Leadership Team edit a ministry they don't lead", async () => {
    expect(await callerCanEditMinistryOkrs(db, "lt", WORSHIP)).toBe(false);
    expect(await callerCanEditMinistryOkrs(db, "lt", MEDIA)).toBe(true);
    expect(await callerCanEditMinistryOkrs(db, "lt", null)).toBe(false);
  });

  it("refuses plain members and inactive leaders", async () => {
    expect(await callerCanEditMinistryOkrs(db, "member", WORSHIP)).toBe(false);
    expect(await callerCanEditMinistryOkrs(db, "former", WORSHIP)).toBe(false);
  });
});

describe("callerCanCreateOkr", () => {
  it("applies the same rule at insert time", async () => {
    const worship = { scope: "ministry" as const, ministryId: WORSHIP, ownerUserId: null };
    expect(await callerCanCreateOkr(db, "wl", worship)).toBe(true);
    expect(await callerCanCreateOkr(db, "lt", worship)).toBe(false);
  });

  it("lets anyone add their own personal objective", async () => {
    expect(
      await callerCanCreateOkr(db, "member", { scope: "individual", ministryId: WORSHIP, ownerUserId: "member" })
    ).toBe(true);
    expect(
      await callerCanCreateOkr(db, "lt", { scope: "individual", ministryId: WORSHIP, ownerUserId: "member" })
    ).toBe(false);
  });
});

describe("callerCanEditObjective / callerCanEditKeyResult", () => {
  it("resolves the objective's ministry before deciding", async () => {
    expect(await callerCanEditObjective(db, "wl", "obj-worship")).toBe(true);
    expect(await callerCanEditObjective(db, "lt", "obj-worship")).toBe(false);
    expect(await callerCanEditObjective(db, "lt", "obj-media")).toBe(true);
  });

  it("lets the owner and their leader edit a personal objective, not leadership", async () => {
    expect(await callerCanEditObjective(db, "member", "obj-personal")).toBe(true);
    expect(await callerCanEditObjective(db, "wl", "obj-personal")).toBe(true);
    expect(await callerCanEditObjective(db, "lt", "obj-personal")).toBe(false);
  });

  it("refuses an objective the caller can't see (or that doesn't exist)", async () => {
    expect(await callerCanEditObjective(db, "super", "missing")).toBe(false);
  });

  it("walks a key result up to its objective", async () => {
    expect(await callerCanEditKeyResult(db, "wl", "kr-worship")).toBe(true);
    expect(await callerCanEditKeyResult(db, "lt", "kr-worship")).toBe(false);
    expect(await callerCanEditKeyResult(db, "wl", "missing")).toBe(false);
  });
});

describe("callerCanAmendCheckin", () => {
  it("allows the author and admins only", async () => {
    expect(await callerCanAmendCheckin(db, "wl", "ci-1")).toBe(true);
    expect(await callerCanAmendCheckin(db, "general", "ci-1")).toBe(true);
    expect(await callerCanAmendCheckin(db, "lt", "ci-1")).toBe(false);
    expect(await callerCanAmendCheckin(db, "wl", "missing")).toBe(false);
  });
});

describe("callerCanManageCycles", () => {
  it("still lets the Leadership Team run cycles", async () => {
    expect(await callerCanManageCycles(db, "lt")).toBe(true);
    expect(await callerCanManageCycles(db, "general")).toBe(true);
    expect(await callerCanManageCycles(db, "wl")).toBe(false);
  });
});
