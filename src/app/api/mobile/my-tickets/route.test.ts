import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, filterValue, type FakeQuery } from "@/lib/testing/fake-supabase";

// GET /api/mobile/my-tickets: only the caller's own tickets. The contact id
// comes from the caller's client; service-role reads are filtered to it.

const state = vi.hoisted(() => ({
  user: null as unknown as ReturnType<typeof import("@/lib/testing/fake-supabase").createFakeSupabase>,
  admin: null as unknown as ReturnType<typeof import("@/lib/testing/fake-supabase").createFakeSupabase>,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.user.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.admin.client }));

import { GET } from "./route";

const EVENT = {
  id: "e1",
  title: "Send Night",
  start_date: "2026-12-01",
  start_time: "18:00:00",
  end_date: null,
  end_time: null,
  location: "Cape Town",
  status: "published",
};

function world(opts: {
  signedIn?: boolean;
  contactId?: string | null;
  adminError?: string;
  registrations?: unknown[];
}) {
  state.user = createFakeSupabase({
    user: opts.signedIn === false ? null : { id: "u1" },
    resolve: (q: FakeQuery) => {
      if (q.table === "users") return { data: { contact_id: opts.contactId === undefined ? "c1" : opts.contactId } };
      if (q.table === "event_registrations") return { data: opts.registrations ?? [] };
      return { data: [] };
    },
  });
  state.admin = createFakeSupabase({
    user: null,
    resolve: (q: FakeQuery) => {
      if (opts.adminError && q.table === "tickets") return { error: { message: opts.adminError } };
      if (q.table === "orders" && filterValue(q, "eq", "buyer_contact_id") === "c1") {
        return { data: [{ id: "o1", buyer_first_name: "Sample", buyer_last_name: "Person 199" }] };
      }
      if (q.table === "orders") {
        const ids = (filterValue(q, "in", "id") as string[]) ?? [];
        return { data: ids.map((id) => ({ id, buyer_first_name: "Sample", buyer_last_name: "Person 199" })) };
      }
      if (q.table === "tickets") {
        const ids = (filterValue(q, "in", "order_id") as string[]) ?? [];
        return {
          data: ids.map((orderId, i) => ({
            id: `t${i}`,
            code: `CODE${i}xyz`,
            status: "valid",
            checked_in_at: null,
            order_id: orderId,
            waiver_signature: { signed_at: "2026-10-01T00:00:00Z", guardian_name: "secret" },
            ticket_types: { name: "General", waiver: { enabled: true } },
            events: { ...EVENT, id: `e-${orderId}` },
          })),
        };
      }
      return { data: [] };
    },
  });
}

describe("GET /api/mobile/my-tickets", () => {
  beforeEach(() => world({}));

  it("401 JSON when not signed in", async () => {
    world({ signedIn: false });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
    expect(state.admin.queries).toHaveLength(0);
  });

  it("returns an empty list (and never touches service role) when the user has no contact", async () => {
    world({ contactId: null });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tickets: [], registrations: [] });
    expect(state.admin.queries).toHaveLength(0);
  });

  it("reads the contact through the caller's own client, scoped to their user id", async () => {
    await GET();
    const users = state.user.queries.find((q) => q.table === "users")!;
    expect(filterValue(users, "eq", "id")).toBe("u1");
    const orders = state.admin.queries.find((q) => q.table === "orders")!;
    expect(filterValue(orders, "eq", "buyer_contact_id")).toBe("c1");
    const regs = state.user.queries.find((q) => q.table === "event_registrations")!;
    expect(filterValue(regs, "eq", "contact_id")).toBe("c1");
  });

  it("returns the contract shape, no-store, without waiver secrets", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.tickets).toEqual([
      expect.objectContaining({
        id: "t0",
        code: "CODE0xyz",
        status: "valid",
        holderName: "Sample Person 199",
        ticketTypeName: "General",
        waiver: { required: true, signed: true, signedAt: "2026-10-01T00:00:00Z", title: null, hasDocument: false },
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("includes orders linked from the caller's registrations", async () => {
    world({
      registrations: [{ id: "r1", status: "confirmed", order_id: "o-unresolved", events: { ...EVENT, id: "e-x" } }],
    });
    const body = await (await GET()).json();
    expect(body.tickets.map((t: { id: string }) => t.id)).toHaveLength(2);
    const ticketQuery = state.admin.queries.find((q) => q.table === "tickets")!;
    expect(filterValue(ticketQuery, "in", "order_id")).toEqual(["o1", "o-unresolved"]);
  });

  it("500 JSON on a read error", async () => {
    world({ adminError: "boom" });
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "server_error", message: "boom" });
  });
});
