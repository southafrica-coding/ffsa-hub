import { describe, expect, it } from "vitest";
import { canOpenSchools, programsVisibleOnSchoolsHome } from "@/lib/schools/program-staff-access";
import {
  createFakeSupabase,
  permissionWorldResolver,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";
import {
  canCreateProgram,
  getAccessibleSchoolsProgramIds,
} from "./schools-program-access";

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function client(world: PermissionWorld) {
  return createFakeSupabase({
    resolve: (q) => permissionWorldResolver(world)(q) ?? { data: [] },
  }).client;
}

const SCOPED: PermissionWorld = {
  roles: [{ id: "pl", name: "program_leader", scopeType: "program", scopeId: A }],
  direct: [{ module: "schools", key: "schools.manage", scopeType: "program", scopeId: A }],
  bundles: { pl: [{ module: "schools", key: "schools.manage" }] },
};

describe("getAccessibleSchoolsProgramIds", () => {
  it("returns only the scoped leader's programs", async () => {
    const both: PermissionWorld = {
      roles: [
        { id: "pl", name: "program_leader", scopeType: "program", scopeId: A },
        { id: "pl", name: "program_leader", scopeType: "program", scopeId: B },
      ],
      direct: [],
      bundles: { pl: [{ module: "schools", key: "schools.view_applications" }] },
    };
    expect(await getAccessibleSchoolsProgramIds(client(SCOPED), "u")).toEqual([A]);
    expect([...(await getAccessibleSchoolsProgramIds(client(both), "u"))].sort()).toEqual([A, B]);
  });

  it("returns all programs for an unscoped schools grant or an unscoped admin", async () => {
    expect(
      await getAccessibleSchoolsProgramIds(
        client({ roles: [], direct: [{ module: "schools", key: "schools.manage" }] }),
        "u"
      )
    ).toBe("all");
    expect(
      await getAccessibleSchoolsProgramIds(
        client({ roles: [{ id: "a", name: "admin" }], direct: [] }),
        "u"
      )
    ).toBe("all");
  });

  it("does not treat schools.assignable_as_contact as Training access", async () => {
    const scoped: PermissionWorld = {
      roles: [],
      direct: [
        { module: "schools", key: "schools.assignable_as_contact", scopeType: "program", scopeId: A },
      ],
    };
    const unscoped: PermissionWorld = {
      roles: [{ id: "r", name: "staff" }],
      direct: [{ module: "schools", key: "schools.assignable_as_contact" }],
      bundles: { r: [{ module: "schools", key: "schools.assignable_as_contact" }] },
    };
    expect(await getAccessibleSchoolsProgramIds(client(scoped), "u")).toEqual([]);
    expect(await getAccessibleSchoolsProgramIds(client(unscoped), "u")).toEqual([]);
    expect(await canOpenSchools(client(scoped), "u")).toMatchObject({ open: false, hasModuleAccess: false });
    expect(await canOpenSchools(client(unscoped), "u")).toMatchObject({ open: false, hasModuleAccess: false });
  });

  it("returns nothing for a deactivated scoped leader", async () => {
    const world: PermissionWorld = { ...SCOPED, active: false };
    expect(await getAccessibleSchoolsProgramIds(client(world), "u")).toEqual([]);
    expect(await canOpenSchools(client(world), "u")).toMatchObject({ open: false });
  });

  it("fails closed when a lookup errors", async () => {
    const fake = createFakeSupabase({
      resolve: (q) =>
        q.table === "users"
          ? { data: { is_active: true } }
          : { data: null, error: { message: "boom" } },
    });
    expect(await getAccessibleSchoolsProgramIds(fake.client, "u")).toEqual([]);
  });

  it("ignores a team or event scope", async () => {
    const world: PermissionWorld = {
      roles: [],
      direct: [{ module: "schools", key: "schools.manage", scopeType: "team", scopeId: A }],
    };
    expect(await getAccessibleSchoolsProgramIds(client(world), "u")).toEqual([]);
  });
});

describe("Training home and Create Program", () => {
  const programs = [{ id: A }, { id: B }];

  it("shows a scoped leader only their programs, and an unscoped user every program", () => {
    expect(
      programsVisibleOnSchoolsHome(programs, {
        hasModuleAccess: false,
        staffProgramIds: [],
        grantProgramIds: [A],
      })
    ).toEqual([{ id: A }]);
    expect(
      programsVisibleOnSchoolsHome(programs, {
        hasModuleAccess: true,
        staffProgramIds: [],
        grantProgramIds: [A],
      })
    ).toEqual(programs);
  });

  it("opens Training home for a scoped leader without giving them every school", async () => {
    const access = await canOpenSchools(client(SCOPED), "u");
    expect(access.open).toBe(true);
    expect(access.hasModuleAccess).toBe(false);
    expect(access.grantProgramIds).toEqual([A]);
    expect(canCreateProgram(access.schools)).toBe(false);
  });

  it("lets an unscoped user create a program and denies a scoped leader", async () => {
    const unscoped = await getAccessibleSchoolsProgramIds(
      client({ roles: [], direct: [{ module: "schools", key: "schools.manage" }] }),
      "u"
    );
    const scoped = await getAccessibleSchoolsProgramIds(client(SCOPED), "u");
    expect(canCreateProgram(unscoped)).toBe(true);
    expect(canCreateProgram(scoped)).toBe(false);
  });
});
