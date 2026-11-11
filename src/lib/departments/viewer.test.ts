import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeQuery } from "@/lib/testing/fake-supabase";
import { createFakeSupabase } from "@/lib/testing/fake-supabase";
import {
  INACTIVE_ADMIN,
  LEADER,
  LEADERSHIP,
  MEDIA,
  MEMBER,
  OUTSIDER,
  WORSHIP_LEADER,
  makeDepartmentWorld,
  resolveDepartmentWorld,
  type DepartmentWorld,
} from "@/lib/testing/department-world";
import {
  loadDepartmentHomeForViewer,
  loadDepartmentsIndexForViewer,
  loadHomeForViewer,
  loadServicesForViewer,
} from "./viewer";

const h = vi.hoisted(() => ({
  userId: null as string | null,
  world: null as DepartmentWorld | null,
  adminErrors: {} as Record<string, boolean>,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    createFakeSupabase({
      user: h.userId ? { id: h.userId } : null,
      resolve: (query: FakeQuery) => {
        const world = h.world as DepartmentWorld;
        world.callerId = h.userId;
        const errors = { ...(world.errors ?? {}), ...h.adminErrors };
        return resolveDepartmentWorld({ ...world, errors }, query);
      },
    }).client,
}));

function client(userId: string | null) {
  h.userId = userId;
  const world = h.world as DepartmentWorld;
  return createFakeSupabase({
    user: userId ? { id: userId } : null,
    resolve: (query: FakeQuery) => {
      world.callerId = userId;
      return resolveDepartmentWorld(world, query);
    },
  }).client;
}

beforeEach(() => {
  h.userId = MEMBER;
  h.adminErrors = {};
  h.world = makeDepartmentWorld();
});

describe("viewer wrappers", () => {
  it("does not take an admin client parameter", () => {
    const files = ["src/lib/departments/viewer.ts", "src/lib/services/viewer.ts"];
    const signatures = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return [...text.matchAll(/export async function (\w+)\(([^)]*)\)/g)].map((match) => match[0]);
    });
    expect(signatures.length).toBeGreaterThan(0);
    for (const signature of signatures) expect(signature).not.toMatch(/admin/i);
    expect(readFileSync("src/lib/services/viewer.ts", "utf8")).toMatch(/loadServicesForViewer/);
  });

  it("returns every index outcome", async () => {
    expect((await loadDepartmentsIndexForViewer(client(null))).kind).toBe("unauthenticated");
    expect((await loadDepartmentsIndexForViewer(client(INACTIVE_ADMIN))).kind).toBe("forbidden");

    h.world = makeDepartmentWorld();
    h.world.errors = { staff_ministry_members: true };
    expect((await loadDepartmentsIndexForViewer(client(MEMBER))).kind).toBe("forbidden");

    h.world = makeDepartmentWorld();
    h.adminErrors = { staff_ministry_members: true };
    expect((await loadDepartmentsIndexForViewer(client(MEMBER))).kind).toBe("error");

    h.adminErrors = {};
    const listed = await loadDepartmentsIndexForViewer(client(MEMBER));
    expect(listed.kind).toBe("ok");
    if (listed.kind === "ok") expect(listed.data.some((row) => row.slug === "media")).toBe(true);
  });

  it("returns every department home outcome, including the donors_dev canonical slug", async () => {
    expect((await loadDepartmentHomeForViewer(client(null), "media")).kind).toBe("unauthenticated");
    expect((await loadDepartmentHomeForViewer(client(INACTIVE_ADMIN), "media")).kind).toBe("forbidden");

    h.world = makeDepartmentWorld();
    h.world.errors = { users: true };
    expect((await loadDepartmentHomeForViewer(client(MEMBER), "media")).kind).toBe("forbidden");

    h.world = makeDepartmentWorld();
    expect((await loadDepartmentHomeForViewer(client(OUTSIDER), "media")).kind).toBe("not_found");
    expect((await loadDepartmentHomeForViewer(client(LEADER), "woven")).kind).toBe("not_found");

    h.world.errors = { okr_cycles: true };
    expect((await loadDepartmentHomeForViewer(client(LEADER), "media")).kind).toBe("error");

    h.world = makeDepartmentWorld();
    const home = await loadDepartmentHomeForViewer(client(LEADER), "media");
    expect(home.kind).toBe("ok");

    const donors = "d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0";
    const donor = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1";
    h.world.ministries.push({
      id: donors,
      slug: "donors_dev",
      name: "Donors & Development",
      description: null,
      is_active: true,
      ministry_type: "main",
      sort_order: 61,
      parent_id: null,
    });
    h.world.people.push({
      id: donor,
      first_name: "Dee",
      last_name: "Dev",
      preferred_name: null,
      display_name: null,
      email: "dee@example.com",
      job_title: null,
      is_active: true,
    });
    h.world.memberships.push({
      id: "m-donor",
      user_id: donor,
      staff_ministry_id: donors,
      member_role: "member",
      is_point_leader: false,
      status: "active",
    });
    const folded = await loadDepartmentHomeForViewer(client(donor), "donors_dev");
    expect(folded).toEqual({ kind: "redirect", slug: "finances_legal" });
    const canonical = await loadDepartmentHomeForViewer(client(donor), "finances_legal");
    expect(canonical.kind).toBe("ok");
    if (canonical.kind === "ok") expect(canonical.data.department.slug).toBe("finances_legal");
  });

  it("fills parentName from the loaded rows and leaves it null without a parent", async () => {
    const media = h.world!.ministries.find((row) => row.id === MEDIA);
    if (media) media.parent_id = LEADERSHIP;
    const withParent = await loadDepartmentHomeForViewer(client(LEADER), "media");
    expect(withParent.kind).toBe("ok");
    if (withParent.kind === "ok") {
      expect(withParent.data.department.parentSlug).toBe("leadership_team");
      expect(withParent.data.department.parentName).toBe("Leadership Team");
    }

    const without = await loadDepartmentHomeForViewer(client(WORSHIP_LEADER), "prayer_and_worship");
    expect(without.kind).toBe("ok");
    if (without.kind === "ok") {
      expect(without.data.department.parentSlug).toBeNull();
      expect(without.data.department.parentName).toBeNull();
    }
  });

  it("returns every services outcome", async () => {
    expect((await loadServicesForViewer(client(null))).kind).toBe("unauthenticated");
    expect((await loadServicesForViewer(client(INACTIVE_ADMIN))).kind).toBe("forbidden");

    h.world = makeDepartmentWorld();
    h.world.errors = { service_owners: true };
    expect((await loadServicesForViewer(client(OUTSIDER))).kind).toBe("forbidden");

    h.world = makeDepartmentWorld();
    h.world.errors = { staff_ministries: true };
    expect((await loadServicesForViewer(client(OUTSIDER))).kind).toBe("error");

    h.world = makeDepartmentWorld();
    const services = await loadServicesForViewer(client(OUTSIDER));
    expect(services.kind).toBe("ok");
    if (services.kind === "ok") {
      const gear = services.data.find((row) => row.id === "gear_hire");
      expect(gear?.href).toBe("/hire");
      expect(services.data.some((row) => row.id === "brand_kit")).toBe(false);
    }
    h.world = makeDepartmentWorld();
    h.world.equipmentStaff = true;
    const staff = await loadServicesForViewer(client(OUTSIDER));
    if (staff.kind === "ok") {
      expect(staff.data.find((row) => row.id === "gear_hire")?.href).toBe("/bookings/equipment");
    }
  });

  it("keeps the public gear door when the equipment check fails", async () => {
    h.world = makeDepartmentWorld();
    h.world.equipmentStaff = "error";
    const services = await loadServicesForViewer(client(OUTSIDER));
    expect(services.kind).toBe("ok");
    if (services.kind === "ok") {
      expect(services.data.find((row) => row.id === "gear_hire")?.href).toBe("/hire");
    }
    const home = await loadHomeForViewer(client(OUTSIDER));
    expect(home.kind).toBe("ok");
    if (home.kind === "ok") {
      expect(home.data.services.find((row) => row.id === "gear_hire")?.href).toBe("/hire");
    }
  });

  it("returns every home-dashboard outcome", async () => {
    expect((await loadHomeForViewer(client(null))).kind).toBe("unauthenticated");
    expect((await loadHomeForViewer(client(INACTIVE_ADMIN))).kind).toBe("forbidden");

    h.world = makeDepartmentWorld();
    h.world.errors = { service_owners: true };
    expect((await loadHomeForViewer(client(MEMBER))).kind).toBe("forbidden");

    h.world = makeDepartmentWorld();
    h.world.errors = { rocks: true };
    expect((await loadHomeForViewer(client(MEMBER))).kind).toBe("error");

    h.world = makeDepartmentWorld();
    const home = await loadHomeForViewer(client(MEMBER));
    expect(home.kind).toBe("ok");
    if (home.kind === "ok") {
      expect(home.data.okrCheckInsDue).toEqual([]);
      expect(home.data.departments.some((row) => row.slug === "media")).toBe(true);
    }
  });
});
