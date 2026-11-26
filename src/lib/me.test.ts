import { describe, it, expect } from "vitest";
import { buildMePayload, listRoles, mergePermissions } from "@/lib/me";

const PROGRAM_A = "11111111-1111-1111-1111-111111111111";
const PROGRAM_B = "22222222-2222-2222-2222-222222222222";

describe("mergePermissions", () => {
  it("returns direct grants with their own scope", () => {
    const out = mergePermissions(
      [
        { scope_type: null, scope_id: null, permissions: { key: "events.view" } },
        { scope_type: "program", scope_id: PROGRAM_A, permissions: { key: "schools.manage" } },
      ],
      [],
      []
    );
    expect(out).toEqual([
      { key: "events.view", scopeType: null, scopeId: null, source: "direct" },
      { key: "schools.manage", scopeType: "program", scopeId: PROGRAM_A, source: "direct" },
    ]);
  });

  it("role-bundle grants take the scope of the role ASSIGNMENT (as has_permission_for does)", () => {
    const out = mergePermissions(
      [],
      [
        { role_id: "r-pl", scope_type: "program", scope_id: PROGRAM_A, roles: { name: "program_leader" } },
        { role_id: "r-pl", scope_type: "program", scope_id: PROGRAM_B, roles: { name: "program_leader" } },
      ],
      [{ role_id: "r-pl", permissions: { key: "schools.manage" } }]
    );
    expect(out).toEqual([
      { key: "schools.manage", scopeType: "program", scopeId: PROGRAM_A, source: "role" },
      { key: "schools.manage", scopeType: "program", scopeId: PROGRAM_B, source: "role" },
    ]);
  });

  it("de-duplicates on (key, scope); a key granted both ways is reported once as direct", () => {
    const out = mergePermissions(
      [{ scope_type: null, scope_id: null, permissions: { key: "finance.view" } }],
      [
        { role_id: "r1", scope_type: null, scope_id: null, roles: { name: "finance_office" } },
        { role_id: "r2", scope_type: null, scope_id: null, roles: { name: "staff" } },
      ],
      [
        { role_id: "r1", permissions: { key: "finance.view" } },
        { role_id: "r1", permissions: { key: "finance.donor_statements" } },
        { role_id: "r2", permissions: { key: "finance.donor_statements" } },
      ]
    );
    expect(out).toEqual([
      { key: "finance.donor_statements", scopeType: null, scopeId: null, source: "role" },
      { key: "finance.view", scopeType: null, scopeId: null, source: "direct" },
    ]);
  });

  it("keeps the same key at different scopes as separate entries", () => {
    const out = mergePermissions(
      [{ scope_type: "program", scope_id: PROGRAM_A, permissions: { key: "schools.manage" } }],
      [{ role_id: "r", scope_type: null, scope_id: null, roles: { name: "schools_admin" } }],
      [{ role_id: "r", permissions: { key: "schools.manage" } }]
    );
    expect(out.map((p) => [p.scopeId, p.source])).toEqual([
      [null, "role"],
      [PROGRAM_A, "direct"],
    ]);
  });

  it("ignores bundles for roles the user doesn't hold, and rows with no key", () => {
    const out = mergePermissions(
      [{ scope_type: null, scope_id: null, permissions: null }],
      [{ role_id: "mine", scope_type: null, scope_id: null, roles: { name: "staff" } }],
      [
        { role_id: "someone-elses", permissions: { key: "administration.manage_roles" } },
        { role_id: "mine", permissions: [] },
      ]
    );
    expect(out).toEqual([]);
  });

  it("accepts embedded relations as arrays as well as objects", () => {
    const out = mergePermissions(
      [{ scope_type: null, scope_id: null, permissions: [{ key: "a.b" }] }],
      [],
      []
    );
    expect(out[0].key).toBe("a.b");
  });
});

describe("listRoles", () => {
  it("one entry per (role, scope), sorted, with scope kept", () => {
    expect(
      listRoles([
        { role_id: "2", scope_type: null, scope_id: null, roles: { name: "staff" } },
        { role_id: "1", scope_type: "program", scope_id: PROGRAM_A, roles: { name: "program_leader" } },
        { role_id: "2", scope_type: null, scope_id: null, roles: { name: "staff" } },
        { role_id: "x", scope_type: null, scope_id: null, roles: null },
      ])
    ).toEqual([
      { name: "program_leader", scopeType: "program", scopeId: PROGRAM_A },
      { name: "staff", scopeType: null, scopeId: null },
    ]);
  });
});

describe("buildMePayload", () => {
  it("matches the phone app's contract", () => {
    const body = buildMePayload({
      user: { id: "u1", email: "a@b.test" },
      profile: {
        first_name: "Sample",
        last_name: "Person 199",
        preferred_name: null,
        avatar_url: null,
        is_active: true,
      },
      assignments: [],
      direct: [],
      bundles: [],
      now: new Date("2026-11-02T08:00:00Z"),
    });
    expect(body).toEqual({
      user: { id: "u1", email: "a@b.test" },
      profile: {
        firstName: "Sample",
        lastName: "Person 199",
        preferredName: null,
        avatarUrl: null,
        isActive: true,
      },
      roles: [],
      permissions: [],
      training: null,
      serverTime: "2026-11-02T08:00:00.000Z",
    });
  });

  it("a missing users row still answers, with null names", () => {
    const body = buildMePayload({
      user: { id: "u1" },
      profile: null,
      assignments: [],
      direct: [],
      bundles: [],
      now: new Date(0),
    });
    expect(body.user.email).toBeNull();
    expect(body.profile).toMatchObject({ firstName: null, isActive: true });
  });
});
