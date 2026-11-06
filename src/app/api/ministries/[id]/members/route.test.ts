import { beforeEach, describe, expect, it, vi } from "vitest";

// PATCH /api/ministries/[id]/members approves a pending request only when the
// row is still pending, and says 404 when that update matches nothing.
// Assigning sub-categories is a different body and must keep working on an
// active member.

type Member = {
  id: string;
  staff_ministry_id: string;
  status: "pending" | "active";
  approved_by: string | null;
};

const h = vi.hoisted(() => ({
  userId: "leader-1" as string | null,
  leads: true,
  members: [] as Member[],
  updates: [] as Array<{ patch: Record<string, unknown>; filters: Record<string, unknown> }>,
  subcategoryWrites: 0,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: h.userId ? { id: h.userId } : null } }),
    },
  }),
}));
vi.mock("@/lib/auth/check-ministry-access", () => ({
  callerLeadsMinistry: async () => h.leads,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let op: "select" | "update" | "delete" | "upsert" = "select";
      let patch: Record<string, unknown> | null = null;
      const run = () => {
        if (table === "staff_ministry_members" && op === "update" && patch) {
          h.updates.push({ patch, filters: { ...filters } });
          const matched = h.members.filter(
            (m) =>
              (filters.id === undefined || m.id === filters.id) &&
              (filters.staff_ministry_id === undefined || m.staff_ministry_id === filters.staff_ministry_id) &&
              (filters.status === undefined || m.status === filters.status)
          );
          for (const row of matched) Object.assign(row, patch);
          return { data: matched.map((m) => ({ id: m.id })), error: null };
        }
        if (table === "staff_ministry_members") {
          const row = h.members.find(
            (m) => m.id === filters.id && m.staff_ministry_id === filters.staff_ministry_id
          );
          return { data: row ? [{ id: row.id }] : [], error: null };
        }
        if (table === "staff_ministry_subcategories") {
          const ids = (filters.id as string[] | undefined) ?? [];
          return { data: ids.map((id) => ({ id })), error: null };
        }
        if (table === "staff_ministry_member_subcategories") {
          h.subcategoryWrites += 1;
          return { data: null, error: null };
        }
        return { data: [], error: null };
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        update: (p: Record<string, unknown>) => {
          op = "update";
          patch = p;
          return q;
        },
        delete: () => {
          op = "delete";
          return q;
        },
        upsert: () => {
          op = "upsert";
          return q;
        },
        select: () => q,
        eq: (col: string, v: unknown) => {
          filters[col] = v;
          return q;
        },
        in: (col: string, vs: unknown) => {
          filters[col] = vs;
          return q;
        },
        not: () => q,
        maybeSingle: async () => {
          const result = run();
          const rows = result.data as { id: string }[] | null;
          return { data: rows?.[0] ?? null, error: result.error };
        },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(run()).then(res, rej),
      };
      return q;
    },
  }),
}));

const { PATCH } = await import("./route");

const MINISTRY = "ministry-1";
const ctx = { params: Promise.resolve({ id: MINISTRY }) };
const patch = (body: unknown) =>
  PATCH(
    new Request(`http://localhost/api/ministries/${MINISTRY}/members`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    ctx
  );

beforeEach(() => {
  h.userId = "leader-1";
  h.leads = true;
  h.members = [
    { id: "pending-1", staff_ministry_id: MINISTRY, status: "pending", approved_by: null },
    { id: "active-1", staff_ministry_id: MINISTRY, status: "active", approved_by: "someone" },
    { id: "other-ministry", staff_ministry_id: "ministry-2", status: "pending", approved_by: null },
  ];
  h.updates = [];
  h.subcategoryWrites = 0;
});

describe("PATCH /api/ministries/[id]/members approve", () => {
  it("approves a pending membership and records who approved it", async () => {
    const res = await patch({ membership_id: "pending-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(h.members.find((m) => m.id === "pending-1")).toMatchObject({
      status: "active",
      approved_by: "leader-1",
    });
    expect(h.updates).toEqual([
      {
        patch: { status: "active", approved_by: "leader-1" },
        filters: { id: "pending-1", staff_ministry_id: MINISTRY, status: "pending" },
      },
    ]);
  });

  it("returns 404 when the membership is not pending", async () => {
    const res = await patch({ membership_id: "active-1" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Membership not found" });
    expect(h.members.find((m) => m.id === "active-1")).toMatchObject({
      status: "active",
      approved_by: "someone",
    });
  });

  it("returns 404 when the update matches no row", async () => {
    expect((await patch({ membership_id: "missing" })).status).toBe(404);
    expect((await patch({ membership_id: "other-ministry" })).status).toBe(404);
    expect(h.members.find((m) => m.id === "other-ministry")?.status).toBe("pending");
    expect(h.updates).toHaveLength(2);
  });

  it("still assigns sub-categories on an active member", async () => {
    const res = await patch({ membership_id: "active-1", subcategory_ids: ["cat-1"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(h.updates).toEqual([]);
    expect(h.subcategoryWrites).toBe(2);
    expect(h.members.find((m) => m.id === "active-1")?.status).toBe("active");
  });

  it("refuses someone who is signed out or does not lead the ministry", async () => {
    h.userId = null;
    expect((await patch({ membership_id: "pending-1" })).status).toBe(401);
    h.userId = "leader-1";
    h.leads = false;
    expect((await patch({ membership_id: "pending-1" })).status).toBe(403);
    expect(h.members.find((m) => m.id === "pending-1")?.status).toBe("pending");
    expect(h.updates).toEqual([]);
  });
});
