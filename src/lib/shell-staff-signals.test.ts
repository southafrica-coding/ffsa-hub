import { describe, expect, it } from "vitest";
import { shellVariantForRoles } from "@/components/shell-nav";
import { getSidebarAccess } from "@/lib/sidebar-access";
import { createFakeSupabase, permissionWorldResolver, type PermissionWorld } from "@/lib/testing/fake-supabase";

/** The self_service bundle as stored in production. */
const SELF_SERVICE_BUNDLE = [
  { module: "bookings", key: "bookings.view" },
  { module: "evangelism", key: "evangelism.publish" },
  { module: "evangelism", key: "evangelism.submit" },
  { module: "evangelism", key: "evangelism.view" },
  { module: "vehicles", key: "vehicles.request" },
  { module: "vehicles", key: "vehicles.view" },
];

const membership = [
  { id: "student", name: "student" },
  { id: "ss", name: "self_service" },
];

function world(extra: Partial<PermissionWorld> = {}): PermissionWorld {
  return {
    direct: [],
    ...extra,
    roles: extra.roles ?? membership,
    bundles: extra.bundles ?? { ss: SELF_SERVICE_BUNDLE },
  };
}

async function variant(input: PermissionWorld, programStaff = false) {
  const fake = createFakeSupabase({
    user: { id: "u1" },
    resolve: (query) => {
      if (query.table === "program_staff") return { data: programStaff ? [{ id: "seat" }] : [] };
      return permissionWorldResolver(input)(query) ?? { data: [] };
    },
  });
  const access = await getSidebarAccess(fake.client);
  return {
    shell: shellVariantForRoles(access.roleNames, { staffSignals: access.staffSignals }),
    access,
  };
}

describe("staff shell signals", () => {
  it("keeps self_service with its real bundle on the portal", async () => {
    const result = await variant({
      roles: [{ id: "ss", name: "self_service" }],
      direct: [],
      bundles: { ss: SELF_SERVICE_BUNDLE },
    });
    expect(result.access.permittedModules.has("bookings")).toBe(true);
    expect(result.access.permittedModules.has("vehicles")).toBe(true);
    expect(result.access.staffSignals).toEqual({
      directUnscopedGrant: false,
      staffRoleBundle: false,
      schoolsStaff: false,
    });
    expect(result.shell).toBe("portal");
  });

  it("keeps a student with the self_service bundle on the portal", async () => {
    const result = await variant(world());
    expect(result.access.permittedModules.has("bookings")).toBe(true);
    expect(result.shell).toBe("portal");
  });

  it("keeps a student whose role bundle is empty on the portal", async () => {
    const result = await variant({
      roles: [{ id: "student", name: "student" }],
      direct: [],
      bundles: {},
    });
    expect(result.shell).toBe("portal");
  });

  it("makes a self_service user staff when they also hold a direct unscoped grant", async () => {
    const result = await variant(world({
      direct: [
        { module: "bookings", key: "bookings.request" },
        { module: "bookings", key: "bookings.view" },
        { module: "vehicles", key: "vehicles.request" },
      ],
    }));
    expect(result.access.staffSignals.directUnscopedGrant).toBe(true);
    expect(result.access.staffSignals.schoolsStaff).toBe(false);
    expect(result.shell).toBe("staff");
  });

  it("makes a student staff for a program-scoped schools grant, which is how three production students are staff", async () => {
    const scoped = { scopeType: "program", scopeId: "prog-a" };
    const result = await variant(world({
      direct: [
        { module: "schools", key: "schools.view", ...scoped },
        { module: "schools", key: "schools.approve_applications", ...scoped },
        { module: "schools", key: "schools.assignable_as_contact", ...scoped },
        { module: "schools", key: "schools.manage_attendance", ...scoped },
        { module: "schools", key: "schools.view_applications", ...scoped },
      ],
    }));
    expect(result.access.staffSignals.directUnscopedGrant).toBe(false);
    expect(result.access.staffSignals.schoolsStaff).toBe(true);
    expect(result.access.permittedModules.has("schools")).toBe(true);
    expect(result.shell).toBe("staff");
  });

  it("makes a student staff when they also hold a scoped staff role", async () => {
    const result = await variant(world({
      roles: [
        ...membership,
        { id: "pl", name: "program_leader", scopeType: "program", scopeId: "prog-a" },
      ],
    }));
    expect(result.access.userRoles).not.toContain("program_leader");
    expect(result.access.roleNames).toContain("program_leader");
    expect(result.shell).toBe("staff");
  });

  it("makes a student staff for a program_staff seat", async () => {
    const result = await variant(world(), true);
    expect(result.access.staffSignals.schoolsStaff).toBe(true);
    expect(result.shell).toBe("staff");
  });
});
