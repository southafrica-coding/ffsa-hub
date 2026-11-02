import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeSupabase,
  permissionWorldResolver,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";

// School-fee payments used to need only a sign-in. Now the API matches the
// student_payments RLS (009): record / edit = admins + finance_admin, delete
// = admins only.

const state = vi.hoisted(() => ({
  client: null as unknown,
  writes: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
}));
vi.mock("@/services/school-fees", () => ({
  recordPayment: async () => {
    state.writes.push("record");
    return { data: { id: "p1" }, error: null };
  },
  updatePayment: async () => {
    state.writes.push("update");
    return { data: { id: "p1" }, error: null };
  },
  deletePayment: async () => {
    state.writes.push("delete");
    return { error: null };
  },
}));

import { DELETE, POST, PUT } from "./route";

function as(world: PermissionWorld | null) {
  const fake = createFakeSupabase({
    user: world ? { id: "u1" } : null,
    resolve: (q) => (world ? permissionWorldResolver(world)(q) : null) ?? { data: [] },
  });
  state.client = fake.client;
}

const role = (name: string): PermissionWorld => ({ roles: [{ id: `r-${name}`, name }], direct: [] });
const STAFF = role("staff");
const FINANCE_ADMIN = role("finance_admin");
const ADMIN = role("admin");

const json = (method: string, body: unknown) =>
  new Request("https://hub.test/api/finance/school-fees/payments", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const recordBody = { student_fee_id: "sf1", amount_zar: 100, payment_method: "eft" };
const del = () =>
  new Request("https://hub.test/api/finance/school-fees/payments?id=p1", { method: "DELETE" });

beforeEach(() => {
  state.writes.length = 0;
});

describe("school-fee payments API", () => {
  it("401 when signed out", async () => {
    as(null);
    expect((await POST(json("POST", recordBody))).status).toBe(401);
    expect((await PUT(json("PUT", { id: "p1" }))).status).toBe(401);
    expect((await DELETE(del())).status).toBe(401);
    expect(state.writes).toEqual([]);
  });

  it("403 for a signed-in user without finance access (was: allowed through to the database)", async () => {
    as(STAFF);
    expect((await POST(json("POST", recordBody))).status).toBe(403);
    expect((await PUT(json("PUT", { id: "p1", notes: "x" }))).status).toBe(403);
    expect((await DELETE(del())).status).toBe(403);
    expect(state.writes).toEqual([]);
  });

  it("finance_admin can record and edit, but not delete (RLS: admins only)", async () => {
    as(FINANCE_ADMIN);
    expect((await POST(json("POST", recordBody))).status).toBe(200);
    expect((await PUT(json("PUT", { id: "p1", notes: "x" }))).status).toBe(200);
    expect((await DELETE(del())).status).toBe(403);
    expect(state.writes).toEqual(["record", "update"]);
  });

  it("admin can do all three", async () => {
    as(ADMIN);
    expect((await POST(json("POST", recordBody))).status).toBe(200);
    expect((await PUT(json("PUT", { id: "p1", notes: "x" }))).status).toBe(200);
    expect((await DELETE(del())).status).toBe(200);
    expect(state.writes).toEqual(["record", "update", "delete"]);
  });
});
