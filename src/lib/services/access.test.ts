import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "@/lib/testing/fake-supabase";
import {
  ADMIN,
  FINANCE,
  HULK,
  HULK_MEMBER,
  INACTIVE_ADMIN,
  LEADERSHIP,
  MEDIA,
  MEMBER,
  OPERATIONS,
  OPS_MEMBER,
  OUTSIDER,
  WORSHIP,
  WORSHIP_LEADER,
  WORSHIP_MEMBER,
  makeDepartmentWorld,
  resolveDepartmentWorld,
  type DepartmentWorld,
} from "@/lib/testing/department-world";
import { seedGrants, SERVICE_OWNER_SEED } from "./seed";
import {
  canManageService,
  canModerateService,
  canUseService,
  getServiceOwners,
  grantMatches,
  holdsServiceCapability,
  toServiceOwnership,
} from "./access";

const IDS: Record<string, string> = {
  media: MEDIA,
  hulk: HULK,
  leadership_team: LEADERSHIP,
  prayer_and_worship: WORSHIP,
  operations: OPERATIONS,
  finances_legal: FINANCE,
};

function grants(key: string) {
  return seedGrants(IDS).filter((row) => row.service_key === key);
}

function client(world: DepartmentWorld) {
  return createFakeSupabase({ resolve: (q) => resolveDepartmentWorld(world, q) }).client;
}

describe("service owner seed", () => {
  it("matches the four ownership rules", () => {
    const slugs = (key: string, capability: string) =>
      SERVICE_OWNER_SEED.filter((row) => row.service_key === key && row.capability === capability).map(
        (row) => row.ministry_slug
      );

    expect(slugs("communications", "manage").sort()).toEqual(["hulk", "leadership_team", "media"]);
    expect(slugs("contacts", "manage").sort()).toEqual(["hulk", "leadership_team", "media"]);
    expect(slugs("evangelism", "moderate").sort()).toEqual(["hulk", "media"]);
    expect(slugs("gear_hire", "own").sort()).toEqual(["media", "operations", "prayer_and_worship"]);
    expect(SERVICE_OWNER_SEED.find((row) => row.service_key === "contacts" && row.any_point_leader)).toMatchObject({
      capability: "use",
      member_role: "leader",
      ministry_slug: null,
      admin_href: "/contacts",
    });
  });

  it("lets the named ministries manage, use or moderate, and keeps ownership separate", () => {
    const media = [{ staff_ministry_id: MEDIA, member_role: "member" as const }];
    const hulk = [{ staff_ministry_id: HULK, member_role: "member" as const }];
    const worshipLeader = [{ staff_ministry_id: WORSHIP, member_role: "leader" as const }];
    const worshipMember = [{ staff_ministry_id: WORSHIP, member_role: "member" as const }];
    const ops = [{ staff_ministry_id: OPERATIONS, member_role: "member" as const }];

    expect(holdsServiceCapability(grants("communications"), media, "manage", false)).toBe(true);
    expect(holdsServiceCapability(grants("communications"), media, "use", false)).toBe(true);
    expect(holdsServiceCapability(grants("communications"), media, "moderate", false)).toBe(false);
    expect(holdsServiceCapability(grants("communications"), worshipLeader, "manage", false)).toBe(false);

    expect(holdsServiceCapability(grants("contacts"), hulk, "manage", false)).toBe(true);
    expect(holdsServiceCapability(grants("contacts"), worshipLeader, "use", false)).toBe(true);
    expect(holdsServiceCapability(grants("contacts"), worshipLeader, "manage", false)).toBe(false);
    expect(holdsServiceCapability(grants("contacts"), worshipMember, "use", false)).toBe(false);

    expect(holdsServiceCapability(grants("evangelism"), media, "moderate", false)).toBe(true);
    expect(holdsServiceCapability(grants("evangelism"), hulk, "moderate", false)).toBe(true);
    expect(holdsServiceCapability(grants("evangelism"), media, "manage", false)).toBe(false);
    expect(holdsServiceCapability(grants("evangelism"), media, "use", false)).toBe(false);

    expect(holdsServiceCapability(grants("gear_hire"), ops, "manage", false)).toBe(false);
    expect(holdsServiceCapability(grants("gear_hire"), ops, "use", false)).toBe(false);
    expect(holdsServiceCapability(grants("gear_hire"), media, "moderate", false)).toBe(false);

    expect(holdsServiceCapability(grants("communications"), [], "manage", true)).toBe(true);
    expect(holdsServiceCapability([], media, "manage", true)).toBe(false);

    const gear = toServiceOwnership(
      "gear_hire",
      grants("gear_hire"),
      [
        { id: WORSHIP, slug: "prayer_and_worship", name: "Prayer & Worship" },
        { id: OPERATIONS, slug: "operations", name: "Operations" },
        { id: MEDIA, slug: "media", name: "Media" },
      ]
    );
    expect(gear.admin_href).toBe("/bookings/equipment/gear");
    expect(gear.owners.map((owner) => owner.slug)).toEqual(["media", "operations", "prayer_and_worship"]);
  });

  it("does not treat a point-leader flag on a plain member as a ministry leader", () => {
    const contacts = grants("contacts").find((row) => row.any_point_leader);
    expect(contacts).toBeTruthy();
    expect(
      grantMatches(contacts!, [{ staff_ministry_id: MEDIA, member_role: "member" }], "use")
    ).toBe(false);
    expect(
      grantMatches(contacts!, [{ staff_ministry_id: WORSHIP, member_role: "leader" }], "use")
    ).toBe(true);
  });
});

describe("canManageService, canUseService, canModerateService", () => {
  it("follows the seed for members, leaders and admins", async () => {
    const db = client(makeDepartmentWorld());
    expect(await canManageService(db, MEMBER, "communications")).toBe(true);
    expect(await canUseService(db, MEMBER, "communications")).toBe(true);
    expect(await canModerateService(db, MEMBER, "communications")).toBe(false);
    expect(await canManageService(db, HULK_MEMBER, "communications")).toBe(true);
    expect(await canUseService(db, WORSHIP_LEADER, "contacts")).toBe(true);
    expect(await canManageService(db, WORSHIP_LEADER, "contacts")).toBe(false);
    expect(await canUseService(db, WORSHIP_MEMBER, "contacts")).toBe(false);
    expect(await canModerateService(db, HULK_MEMBER, "evangelism")).toBe(true);
    expect(await canManageService(db, HULK_MEMBER, "evangelism")).toBe(false);
    expect(await canManageService(db, OPS_MEMBER, "gear_hire")).toBe(false);
    expect(await canManageService(db, ADMIN, "evangelism")).toBe(true);
    expect(await canModerateService(db, ADMIN, "evangelism")).toBe(true);
    expect(await canUseService(db, ADMIN, "gear_hire")).toBe(true);
    expect(await canManageService(db, OUTSIDER, "communications")).toBe(false);
    expect(await canManageService(db, ADMIN, "not_a_service")).toBe(false);
  });

  it("denies an inactive admin", async () => {
    const db = client(makeDepartmentWorld());
    expect(await canManageService(db, INACTIVE_ADMIN, "communications")).toBe(false);
    expect(await canUseService(db, INACTIVE_ADMIN, "contacts")).toBe(false);
    expect(await canModerateService(db, INACTIVE_ADMIN, "evangelism")).toBe(false);
  });

  it("denies when the account, role, membership or service_owners lookup fails", async () => {
    for (const table of ["users", "user_roles", "staff_ministry_members", "service_owners"] as const) {
      const world = makeDepartmentWorld();
      world.errors = { [table]: true };
      const db = client(world);
      expect(await canManageService(db, MEMBER, "communications")).toBe(false);
      expect(await canManageService(db, ADMIN, "communications")).toBe(false);
      expect(await canUseService(db, WORSHIP_LEADER, "contacts")).toBe(false);
      expect(await canModerateService(db, HULK_MEMBER, "evangelism")).toBe(false);
    }
  });
});

describe("getServiceOwners", () => {
  it("returns the owning ministries and admin_href, or null for an unknown key", async () => {
    const db = client(makeDepartmentWorld());
    const gear = await getServiceOwners(db, "gear_hire");
    expect(gear.error).toBeNull();
    expect(gear.data?.admin_href).toBe("/bookings/equipment/gear");
    expect(gear.data?.owners.map((owner) => owner.slug)).toEqual(["media", "operations", "prayer_and_worship"]);

    const contacts = await getServiceOwners(db, "contacts");
    expect(contacts.data?.owners.map((owner) => owner.slug)).toEqual(["hulk", "leadership_team", "media"]);
    expect(contacts.data?.admin_href).toBe("/contacts");

    const missing = await getServiceOwners(db, "not_a_service");
    expect(missing).toEqual({ data: null, error: null });
  });

  it("returns the lookup error instead of an empty owner list", async () => {
    const world = makeDepartmentWorld();
    world.errors = { service_owners: true };
    const result = await getServiceOwners(client(world), "communications");
    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/service_owners/);
  });
});
