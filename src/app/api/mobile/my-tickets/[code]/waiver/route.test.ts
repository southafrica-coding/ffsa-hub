import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, filterValue, type FakeQuery } from "@/lib/testing/fake-supabase";

// GET /api/mobile/my-tickets/[code]/waiver: a short-lived link to the
// caller's OWN signed waiver; anyone else's ticket looks like a missing one.

const state = vi.hoisted(() => ({
  user: null as unknown as { client: unknown; queries: unknown[] },
  admin: null as unknown as { client: unknown; queries: unknown[] },
  signed: [] as Array<{ path: string; expires: number }>,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.user.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.admin.client }));

import { GET } from "./route";

function world(opts: {
  signedIn?: boolean;
  ticketOrder?: string | null;
  certificate?: string | null;
  registrationOrder?: string;
}) {
  state.signed = [];
  state.user = createFakeSupabase({
    user: opts.signedIn === false ? null : { id: "u1" },
    resolve: (q: FakeQuery) => {
      if (q.table === "users") return { data: { contact_id: "c1" } };
      if (q.table === "event_registrations") {
        return { data: opts.registrationOrder ? [{ id: "r1", order_id: opts.registrationOrder }] : [] };
      }
      return { data: [] };
    },
  });
  const fake = createFakeSupabase({
    user: null,
    resolve: (q: FakeQuery) => {
      if (q.table === "tickets") {
        if (opts.ticketOrder === null) return { data: null };
        return {
          data: {
            id: "t1",
            order_id: opts.ticketOrder ?? "o1",
            waiver_signature:
              opts.certificate === null ? null : { signed_at: "x", certificate_path: opts.certificate ?? "certs/t1.pdf" },
          },
        };
      }
      if (q.table === "orders" && filterValue(q, "eq", "buyer_contact_id") === "c1") return { data: [{ id: "o1" }] };
      return { data: [] };
    },
  });
  state.admin = {
    queries: fake.queries,
    client: {
      ...fake.client,
      storage: {
        from: (bucket: string) => ({
          createSignedUrl: async (path: string, expires: number) => {
            state.signed.push({ path, expires });
            return { data: { signedUrl: `https://storage.test/${bucket}/${path}?token=x` }, error: null };
          },
        }),
      },
    },
  };
}

const call = (code: string) => GET(new Request("https://hub.test"), { params: Promise.resolve({ code }) });

describe("GET /api/mobile/my-tickets/[code]/waiver", () => {
  beforeEach(() => world({}));

  it("401 when not signed in", async () => {
    world({ signedIn: false });
    expect((await call("AbCdEfGhIjK")).status).toBe(401);
  });

  it("400 for a malformed code, before any lookup", async () => {
    const res = await call("not a code!");
    expect(res.status).toBe(400);
    expect(state.admin.queries).toHaveLength(0);
  });

  it("returns a 5-minute signed link for the caller's own ticket", async () => {
    const res = await call("AbCdEfGhIjK");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      url: "https://storage.test/waiver-documents/certs/t1.pdf?token=x",
      expiresIn: 300,
    });
    expect(state.signed).toEqual([{ path: "certs/t1.pdf", expires: 300 }]);
  });

  it("accepts a ticket on an order linked by the caller's registration", async () => {
    world({ ticketOrder: "o-reg", registrationOrder: "o-reg" });
    expect((await call("AbCdEfGhIjK")).status).toBe(200);
  });

  it("404 (not 403) for someone else's ticket, and signs nothing", async () => {
    world({ ticketOrder: "o-other" });
    const res = await call("AbCdEfGhIjK");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ message: "Ticket not found." });
    expect(state.signed).toEqual([]);
  });

  it("404 for an unknown code", async () => {
    world({ ticketOrder: null });
    expect((await call("AbCdEfGhIjK")).status).toBe(404);
  });

  it("404 with a plain message when nothing is signed yet", async () => {
    world({ certificate: null });
    const res = await call("AbCdEfGhIjK");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ message: "There's no signed waiver for this ticket yet." });
  });
});
