import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "@/lib/testing/fake-supabase";
import {
  ADMIN,
  HULK,
  HULK_MEMBER,
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
import {
  audienceFromGrants,
  canManageService,
  canModerateService,
  canUseService,
  mayUseService,
  memberMatchesGrant,
} from "./access";
import { seedGrants, SERVICE_OWNER_SEED } from "./seed";
import { toHubService } from "./present";

const IDS: Record<string, string> = {
  media: MEDIA,
  hulk: HULK,
  leadership_team: LEADERSHIP,
  prayer_and_worship: WORSHIP,
  operations: OPERATIONS,
};

function grants(key: string) {
  return seedGrants(IDS).filter((row) => row.service_key === key);
}

function client(world: DepartmentWorld, userId = MEMBER) {
  world.callerId = userId;
  return createFakeSupabase({ user: { id: userId }, resolve: (q) => resolveDepartmentWorld(world, q) }).client;
}

describe("service owner seed", () => {
  it("gives owners own and manage, and opens gear_hire to everyone", () => {
    const open = SERVICE_OWNER_SEED.filter((row) => row.open_to_all).map((row) => row.service_key).sort();
    expect(open).toEqual(["evangelism", "gear_hire", "prayer_room", "spaces", "vehicles"]);
    const gearOpen = SERVICE_OWNER_SEED.find((row) => row.service_key === "gear_hire" && row.open_to_all);
    expect(gearOpen?.admin_href).toBe("/hire");
    expect(
      SERVICE_OWNER_SEED.filter((row) => row.service_key === "gear_hire" && !row.open_to_all).every(
        (row) => row.admin_href === "/bookings/equipment"
      )
    ).toBe(true);
    expect(SERVICE_OWNER_SEED.some((row) => row.service_key === "brand_kit" && row.open_to_all)).toBe(false);
    expect(SERVICE_OWNER_SEED.some((row) => row.service_key === "evangelism" && row.capability === "moderate")).toBe(false);
    expect(SERVICE_OWNER_SEED.find((row) => row.any_point_leader)).toMatchObject({
      service_key: "contacts",
      capability: "use",
      ministry_slug: null,
    });
  });

  it("derives audience from rows, including gear_hire as all_signed_in", () => {
    expect(audienceFromGrants(grants("gear_hire"))).toBe("all_signed_in");
    expect(audienceFromGrants(grants("communications"))).toBe("owners_only");
    expect(audienceFromGrants(grants("contacts"))).toBe("point_leaders");
    const withoutOpen = grants("gear_hire").filter((row) => !row.open_to_all);
    expect(audienceFromGrants(withoutOpen)).toBe("owners_only");
  });
});

describe("mayUseService", () => {
  const none: never[] = [];

  it("lets any active user use an open_to_all row, including a non-admin", () => {
    expect(mayUseService(grants("gear_hire"), none, false)).toBe(true);
    expect(mayUseService(grants("evangelism"), none, false)).toBe(true);
    expect(mayUseService(grants("communications"), none, false)).toBe(false);
  });

  it("lets a point leader use contacts and not every leader", () => {
    const point = [{ staff_ministry_id: WORSHIP, member_role: "leader" as const, is_point_leader: true }];
    const leader = [{ staff_ministry_id: WORSHIP, member_role: "leader" as const, is_point_leader: false }];
    expect(mayUseService(grants("contacts"), point, false)).toBe(true);
    expect(mayUseService(grants("contacts"), leader, false)).toBe(false);
    expect(mayUseService(grants("contacts"), [{ staff_ministry_id: MEDIA, member_role: "member", is_point_leader: false }], false)).toBe(true);
  });

  it("treats an open_to_all row as use only", () => {
    const open = {
      capability: "use" as const,
      staff_ministry_id: null,
      member_role: null,
      any_point_leader: false,
      open_to_all: true,
    };
    expect(memberMatchesGrant(open, [], "use")).toBe(true);
    expect(memberMatchesGrant(open, [], "manage")).toBe(false);
    expect(memberMatchesGrant(open, [], "moderate")).toBe(false);
    const notUse = { ...open, capability: "manage" as const };
    expect(memberMatchesGrant(notUse, [], "use")).toBe(false);
    expect(memberMatchesGrant(notUse, [], "manage")).toBe(false);
    expect(SERVICE_OWNER_SEED.filter((row) => row.open_to_all).every((row) => row.capability === "use")).toBe(true);
  });

  it("honours member_role, with null meaning any active member", () => {
    const member = [{ staff_ministry_id: MEDIA, member_role: "member" as const, is_point_leader: false }];
    const leader = [{ staff_ministry_id: MEDIA, member_role: "leader" as const, is_point_leader: false }];
    expect(memberMatchesGrant({ capability: "moderate", staff_ministry_id: MEDIA, member_role: null, any_point_leader: false, open_to_all: false }, member, "moderate")).toBe(true);
    expect(memberMatchesGrant({ capability: "use", staff_ministry_id: MEDIA, member_role: "leader", any_point_leader: false, open_to_all: false }, member, "use")).toBe(false);
    expect(memberMatchesGrant({ capability: "use", staff_ministry_id: MEDIA, member_role: "leader", any_point_leader: false, open_to_all: false }, leader, "use")).toBe(true);
  });

  it("lets an unscoped admin use a service that has rows", () => {
    expect(mayUseService(grants("communications"), none, true)).toBe(true);
    expect(mayUseService([], none, true)).toBe(false);
  });
});

describe("canUseService and canManageService", () => {
  it("lets a non-admin use gear_hire and only Media manage communications", async () => {
    const world = makeDepartmentWorld();
    expect(await canUseService(client(world, OUTSIDER), OUTSIDER, "gear_hire")).toBe(true);
    expect(await canManageService(client(world, MEMBER), MEMBER, "communications")).toBe(true);
    expect(await canManageService(client(world, HULK_MEMBER), HULK_MEMBER, "communications")).toBe(false);
    expect(await canUseService(client(world, HULK_MEMBER), HULK_MEMBER, "communications")).toBe(true);
    expect(await canManageService(client(world, OPS_MEMBER), OPS_MEMBER, "gear_hire")).toBe(true);
    expect(await canUseService(client(world, WORSHIP_LEADER), WORSHIP_LEADER, "contacts")).toBe(true);
    expect(await canUseService(client(world, WORSHIP_MEMBER), WORSHIP_MEMBER, "contacts")).toBe(false);
  });

  it("refuses evangelism moderation for an inactive Media or HULC member", async () => {
    const world = makeDepartmentWorld();
    const media = world.people.find((person) => person.id === MEMBER);
    const hulk = world.people.find((person) => person.id === HULK_MEMBER);
    if (media) media.is_active = false;
    if (hulk) hulk.is_active = false;
    expect(await canModerateService(client(world, MEMBER), MEMBER, "evangelism")).toBe(false);
    const hulkClient = client(world, HULK_MEMBER);
    expect(await canModerateService(hulkClient, HULK_MEMBER, "evangelism")).toBe(false);
    const { data } = await hulkClient.rpc("can_moderate_evangelism");
    expect(data).toBe(false);
    world.people.forEach((person) => {
      if (person.id === MEMBER) person.is_active = true;
    });
    world.callerId = MEMBER;
    const active = await client(world, MEMBER).rpc("can_moderate_evangelism");
    expect(active.data).toBe(true);
  });

  it("moderates evangelism only through can_moderate_evangelism", async () => {
    const world = makeDepartmentWorld();
    world.rpcModerate = false;
    expect(await canModerateService(client(world, MEMBER), MEMBER, "evangelism")).toBe(false);
    world.rpcModerate = true;
    expect(await canModerateService(client(world, MEMBER), MEMBER, "evangelism")).toBe(true);
    world.rpcModerate = "error";
    expect(await canModerateService(client(world, ADMIN), ADMIN, "evangelism")).toBe(false);
  });

  it("fails closed when service_owners cannot be read", async () => {
    const world = makeDepartmentWorld();
    world.errors = { service_owners: true };
    expect(await canUseService(client(world, OUTSIDER), OUTSIDER, "gear_hire")).toBe(false);
    expect(await canManageService(client(world, MEMBER), MEMBER, "communications")).toBe(false);
  });
});

describe("toHubService", () => {
  it("maps capabilities to roles and skips null-ministry rows", () => {
    const ministries = [
      { id: MEDIA, slug: "media" },
      { id: HULK, slug: "hulk" },
      { id: OPERATIONS, slug: "operations" },
      { id: WORSHIP, slug: "prayer_and_worship" },
    ];
    const gear = toHubService(
      { service_key: "gear_hire", label: "Gear hire", admin_href: "/bookings/equipment" },
      grants("gear_hire"),
      ministries
    );
    expect(gear.audience).toBe("all_signed_in");
    expect(gear.href).toBe("/hire");
    const register = toHubService(
      { service_key: "gear_hire", label: "Gear hire", admin_href: "/bookings/equipment" },
      grants("gear_hire"),
      ministries,
      true
    );
    expect(register.href).toBe("/bookings/equipment");
    expect(gear.owners.map((owner) => owner.role).sort()).toEqual(["manager", "manager", "manager", "owner", "owner", "owner"]);
    expect(gear.owners.some((owner) => owner.slug == null)).toBe(false);

    const evangelism = toHubService(
      { service_key: "evangelism", label: "Evangelism", admin_href: "/evangelism" },
      grants("evangelism"),
      ministries
    );
    expect(evangelism.owners).toEqual(expect.arrayContaining([
      { slug: "media", role: "moderator" },
      { slug: "hulk", role: "moderator" },
    ]));
    expect(evangelism.audience).toBe("all_signed_in");

    const contacts = toHubService(
      { service_key: "contacts", label: "Contacts", admin_href: "/contacts" },
      grants("contacts"),
      ministries
    );
    expect(contacts.audience).toBe("point_leaders");
  });
});
