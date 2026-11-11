import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeQuery } from "@/lib/testing/fake-supabase";
import { createFakeSupabase } from "@/lib/testing/fake-supabase";
import {
  LEADER,
  MEDIA,
  MEMBER,
  makeDepartmentWorld,
  resolveDepartmentWorld,
  type DepartmentWorld,
} from "@/lib/testing/department-world";
import type { DepartmentAccess } from "./ui-contract";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    cache<T extends (...args: never[]) => unknown>(fn: T): T {
      const store = new WeakMap<object, Map<unknown, ReturnType<T>>>();
      return ((...args: never[]) => {
        const head: unknown = args[0];
        if (typeof head !== "object" || head === null) return fn(...args);
        let level = store.get(head);
        if (!level) {
          level = new Map();
          store.set(head, level);
        }
        const key = args.length === 2 ? args[1] : JSON.stringify(args.slice(1));
        const cached = level.get(key);
        if (cached !== undefined) return cached;
        const value = fn(...args) as ReturnType<T>;
        level.set(key, value);
        return value;
      }) as T;
    },
  };
});

const h = vi.hoisted(() => ({
  userId: null as string | null,
  world: null as DepartmentWorld | null,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    createFakeSupabase({
      user: h.userId ? { id: h.userId } : null,
      resolve: (query: FakeQuery) => {
        const world = h.world as DepartmentWorld;
        world.callerId = h.userId;
        return resolveDepartmentWorld(world, query);
      },
    }).client,
}));

import { buildDepartmentHome, listVisibleDepartments } from "./internal/page";

function session() {
  h.userId = MEMBER;
  return createFakeSupabase({
    user: { id: MEMBER },
    resolve: (query: FakeQuery) => {
      const world = h.world as DepartmentWorld;
      world.callerId = h.userId;
      return resolveDepartmentWorld(world, query);
    },
  });
}

function membershipReads(queries: FakeQuery[]) {
  return queries.filter(
    (query) => query.table === "staff_ministry_members" && (query.columns ?? "").includes("member_role")
  );
}

const detail: DepartmentAccess = {
  canSeeDepartmentDetail: true,
  canSeeBudget: false,
  canEditBudget: false,
  canEditRocks: false,
  canSeePeopleEmails: false,
};

beforeEach(() => {
  h.userId = MEMBER;
  h.world = makeDepartmentWorld();
});

describe("viewer membership request cache", () => {
  it("reads memberships once for the same client and user", async () => {
    const supabase = session();
    const first = await listVisibleDepartments(supabase.client, MEMBER);
    const second = await listVisibleDepartments(supabase.client, MEMBER);
    expect(first.error).toBeNull();
    expect(first.accessError).toBeUndefined();
    expect(second.data).toEqual(first.data);
    expect(membershipReads(supabase.queries)).toHaveLength(1);
  });

  it("reads again for a different user", async () => {
    const supabase = session();
    await listVisibleDepartments(supabase.client, MEMBER);
    await listVisibleDepartments(supabase.client, LEADER);
    expect(membershipReads(supabase.queries)).toHaveLength(2);
  });

  it("reuses that read when the department home is built in the same request", async () => {
    const supabase = session();
    await listVisibleDepartments(supabase.client, MEMBER);
    const row = h.world!.ministries.find((ministry) => ministry.id === MEDIA);
    await buildDepartmentHome(
      createFakeSupabase({
        resolve: (query: FakeQuery) => resolveDepartmentWorld(h.world as DepartmentWorld, query),
      }).client,
      supabase.client,
      MEMBER,
      detail,
      {
        id: String(row?.id),
        name: String(row?.name),
        slug: String(row?.slug),
        description: null,
        purpose: null,
        is_active: true,
        ministry_type: "main",
        sort_order: 30,
        cluster: null,
        parent_id: null,
      }
    );
    expect(membershipReads(supabase.queries)).toHaveLength(1);
  });
});
