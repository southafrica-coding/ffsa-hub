import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/account/deletion-request: the caller's own request, with and without
// migration 289 applied, and what happens when the email can't go out.

type Row = {
  id: string;
  user_id: string;
  status: string;
  reason: string | null;
  source: string;
  requested_at: string;
  cancelled_at: string | null;
  email?: string | null;
  full_name?: string | null;
};

type Op = { table: string; kind: string; filters: Array<[string, string, unknown]>; payload?: unknown };

type Admin = { user_id: string; email: string; is_active: boolean };
type State = {
  user: { id: string; email?: string } | null;
  tableMissing: boolean;
  rows: Row[];
  ops: Op[];
  insertError: null | { code?: string; message: string };
  raceRow: Row | null;
  sendOk: (to: string) => boolean;
  sends: Array<{ to: string; category: string; subject: string; html: string }>;
  admins: Admin[];
  limited: boolean;
  limiterKeys: string[];
};

const state: State = vi.hoisted(() => ({
  user: { id: "me", email: "me@example.com" } as { id: string; email?: string } | null,
  tableMissing: false,
  rows: [] as Row[],
  ops: [] as Op[],
  insertError: null as null | { code?: string; message: string },
  raceRow: null as Row | null,
  sendOk: ((to: string) => !!to) as (to: string) => boolean,
  sends: [] as Array<{ to: string; category: string; subject: string; html: string }>,
  admins: [
    { user_id: "a1", email: "Admin1@ffsa.test", is_active: true },
    { user_id: "a2", email: "admin2@ffsa.test", is_active: false },
  ],
  limited: false,
  limiterKeys: [] as string[],
}));

const MISSING = { code: "PGRST205", message: "Could not find the table 'public.account_deletion_requests' in the schema cache" };

function makeClient(asAdmin: boolean) {
  function builder(table: string) {
    const op: Op = { table, kind: "select", filters: [] };
    let single = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select() {
        return b;
      },
      insert(payload: unknown) {
        op.kind = "insert";
        op.payload = payload;
        return b;
      },
      update(payload: unknown) {
        op.kind = "update";
        op.payload = payload;
        return b;
      },
      order: () => b,
      limit: () => b,
      single() {
        single = true;
        return b;
      },
      maybeSingle() {
        single = true;
        return b;
      },
      then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) {
        return Promise.resolve(run(op, single)).then(ok, bad);
      },
    };
    for (const f of ["eq", "in"]) {
      b[f] = (col: string, val: unknown) => {
        op.filters.push([f, col, val]);
        return b;
      };
    }
    return b;
  }

  function matches(row: Record<string, unknown>, filters: Op["filters"]) {
    return filters.every(([f, col, val]) =>
      f === "eq" ? row[col] === val : (val as unknown[]).includes(row[col])
    );
  }

  function run(op: Op, single: boolean) {
    state.ops.push({ ...op, table: asAdmin ? `admin:${op.table}` : op.table });
    if (op.table === "users" && !asAdmin) {
      return { data: { email: "me@example.com", first_name: "Sample", last_name: "Person 199", display_name: null }, error: null };
    }
    if (op.table === "user_roles") {
      return { data: state.admins.map((a) => ({ user_id: a.user_id, roles: { name: "admin" } })), error: null };
    }
    if (op.table === "users" && asAdmin) {
      const ids = (op.filters.find(([, c]) => c === "id")?.[2] ?? []) as string[];
      return {
        data: state.admins.filter((a) => ids.includes(a.user_id) && a.is_active).map((a) => ({ id: a.user_id, email: a.email })),
        error: null,
      };
    }
    if (op.table === "account_deletion_requests") {
      if (state.tableMissing) return { data: null, error: MISSING };
      if (op.kind === "insert") {
        if (state.insertError) {
          if (state.raceRow) state.rows.push(state.raceRow);
          return { data: null, error: state.insertError };
        }
        const row: Row = {
          id: `r${state.rows.length + 1}`,
          requested_at: "2026-11-03T10:00:00.000Z",
          cancelled_at: null,
          ...(op.payload as Omit<Row, "id" | "requested_at" | "cancelled_at">),
        };
        state.rows.push(row);
        return { data: row, error: null };
      }
      // RLS: the caller's rows only.
      const visible = state.rows.filter((r) => r.user_id === state.user?.id && matches(r, op.filters));
      if (op.kind === "update") {
        for (const r of visible) Object.assign(r, op.payload);
        return { data: visible[0] ?? null, error: null };
      }
      return { data: single ? (visible[0] ?? null) : visible, error: null };
    }
    return { data: null, error: null };
  }

  return {
    from: builder,
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => makeClient(false) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => makeClient(true) }));
vi.mock("@/lib/email/send-transactional", () => ({
  sendTransactional: async (input: { to: string; category: string; subject: string; html: string }) => {
    state.sends.push(input);
    return state.sendOk(input.to) ? { ok: true, id: "e1" } : { ok: false, error: "nope", suppressed: false };
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  getRateLimiter: () => ({
    hit: async (key: string) => {
      state.limiterKeys.push(key);
      return { allowed: !state.limited, remaining: 0, resetAt: new Date(Date.now() + 60_000) };
    },
  }),
  retryAfterSeconds: () => 60,
}));

import { DELETE, GET, POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("https://hub.test/api/account/deletion-request", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

const openRow = (over: Partial<Row> = {}): Row => ({
  id: "r0",
  user_id: "me",
  status: "open",
  reason: null,
  source: "app",
  requested_at: "2026-11-01T08:00:00.000Z",
  cancelled_at: null,
  ...over,
});

beforeEach(() => {
  state.user = { id: "me", email: "me@example.com" };
  state.tableMissing = false;
  state.rows = [];
  state.ops = [];
  state.insertError = null;
  state.raceRow = null;
  state.sendOk = () => true;
  state.sends = [];
  state.limited = false;
  state.limiterKeys = [];
  delete process.env.ACCOUNT_DELETION_NOTIFY_EMAIL;
  delete process.env.ACCOUNT_DELETION_CONTACT_EMAIL;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const adminSends = () => state.sends.filter((s) => s.category !== "account_deletion_confirmation");
const confirmations = () => state.sends.filter((s) => s.category === "account_deletion_confirmation");

describe("auth", () => {
  it("401 on GET, POST and DELETE when signed out", async () => {
    state.user = null;
    expect((await GET()).status).toBe(401);
    expect((await post({ confirm: true })).status).toBe(401);
    expect((await DELETE()).status).toBe(401);
    expect(state.sends).toHaveLength(0);
  });
});

describe("POST validation", () => {
  it("400 without confirm: true", async () => {
    const res = await post({ reason: "bye" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/confirm/i);
  });

  it("400 when confirm is not literally true", async () => {
    expect((await post({ confirm: "yes" })).status).toBe(400);
  });

  it("400 on a reason over 1000 characters", async () => {
    const res = await post({ confirm: true, reason: "x".repeat(1001) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/1000/);
  });

  it("400 on a body that isn't JSON", async () => {
    expect((await post("not json")).status).toBe(400);
  });

  it("ignores a user id in the body: the request is always for the caller", async () => {
    const res = await post({ confirm: true, user_id: "someone-else" });
    expect(res.status).toBe(201);
    expect(state.rows[0].user_id).toBe("me");
  });
});

describe("table present (migration 289 applied)", () => {
  it("records the request, emails the active admins and the person: 201", async () => {
    const res = await post({ confirm: true, reason: "  Leaving the base  ", source: "app" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      recorded: true,
      notified: true,
      confirmationSent: true,
      request: { id: "r1", status: "open", reason: "Leaving the base", requestedAt: "2026-11-03T10:00:00.000Z" },
      contactEmail: "info@fireandfragrance.com",
    });
    expect(state.rows[0]).toMatchObject({ user_id: "me", source: "app", email: "me@example.com", full_name: "Sample Person 199" });
    // Only the ACTIVE admin, lower-cased.
    expect(adminSends().map((s) => s.to)).toEqual(["admin1@ffsa.test"]);
    expect(adminSends()[0].html).toContain("Sample Person 199");
    expect(adminSends()[0].html).toContain("Leaving the base");
    expect(confirmations().map((s) => s.to)).toEqual(["me@example.com"]);
    expect(confirmations()[0].html).toMatch(/within 30 days/);
    expect(state.limiterKeys).toEqual(["account-deletion:me"]);
  });

  it("is idempotent: a second request returns the open one (200) and sends nothing", async () => {
    state.rows = [openRow()];
    const res = await post({ confirm: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ alreadyRequested: true, recorded: true, request: { id: "r0" } });
    expect(state.rows).toHaveLength(1);
    expect(state.sends).toHaveLength(0);
  });

  it("two taps at once: the unique-index clash returns the winner (200)", async () => {
    state.insertError = { code: "23505", message: "duplicate key" };
    state.raceRow = openRow({ id: "winner" });
    const res = await post({ confirm: true });
    expect(res.status).toBe(200);
    expect((await res.json()).request.id).toBe("winner");
    expect(state.sends).toHaveLength(0);
  });

  it("someone else's open request doesn't count as the caller's", async () => {
    state.rows = [openRow({ user_id: "other" })];
    const res = await post({ confirm: true });
    expect(res.status).toBe(201);
    expect(state.rows.filter((r) => r.user_id === "me")).toHaveLength(1);
  });

  it("ACCOUNT_DELETION_NOTIFY_EMAIL replaces the admin list", async () => {
    process.env.ACCOUNT_DELETION_NOTIFY_EMAIL = "Office@ffsa.test, , privacy@ffsa.test";
    await post({ confirm: true });
    expect(adminSends().map((s) => s.to)).toEqual(["office@ffsa.test", "privacy@ffsa.test"]);
    expect(state.ops.some((o) => o.table === "admin:user_roles")).toBe(false);
  });

  it("saved but no admin could be emailed: still 201 (the row is the record), notified:false", async () => {
    state.sendOk = (to) => to === "me@example.com";
    const res = await post({ confirm: true });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ recorded: true, notified: false });
  });

  it("500 with the contact address when the insert fails for another reason", async () => {
    state.insertError = { code: "XX000", message: "boom" };
    const res = await post({ confirm: true });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("info@fireandfragrance.com");
    expect(state.sends).toHaveLength(0);
  });

  it("429 when rate-limited, before anything is written or sent", async () => {
    state.limited = true;
    const res = await post({ confirm: true });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(state.rows).toHaveLength(0);
    expect(state.sends).toHaveLength(0);
  });
});

describe("table missing (migration 289 not applied)", () => {
  beforeEach(() => {
    state.tableMissing = true;
  });

  it("POST still reaches a person: 202 recorded:false, notified:true", async () => {
    const res = await post({ confirm: true, reason: "Moving on" });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ recorded: false, notified: true, confirmationSent: true, request: { id: null, status: "open", reason: "Moving on" } });
    expect(typeof body.request.requestedAt).toBe("string");
    expect(adminSends()).toHaveLength(1);
    expect(adminSends()[0].html).toMatch(/NOT saved in the Hub/);
    expect(confirmations()).toHaveLength(1);
  });

  it("POST: 503 with a plain next step when no admin could be emailed either", async () => {
    state.sendOk = () => false;
    process.env.ACCOUNT_DELETION_CONTACT_EMAIL = "office@ffsa.test";
    const res = await post({ confirm: true });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/couldn't send your request/i);
    expect(body.error).toContain("office@ffsa.test");
    expect(body.contactEmail).toBe("office@ffsa.test");
    // No confirmation email claiming we received it.
    expect(confirmations()).toHaveLength(0);
  });

  it("POST: 503 when there are no admins to tell", async () => {
    state.admins = [];
    const res = await post({ confirm: true });
    expect(res.status).toBe(503);
    state.admins = [
      { user_id: "a1", email: "Admin1@ffsa.test", is_active: true },
      { user_id: "a2", email: "admin2@ffsa.test", is_active: false },
    ];
  });

  it("GET answers no open request", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ request: null, contactEmail: "info@fireandfragrance.com" });
  });

  it("DELETE: 409 asking the person to contact the office", async () => {
    const res = await DELETE();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/email info@fireandfragrance.com/);
  });
});

describe("GET", () => {
  it("returns the caller's open request, no-store", async () => {
    state.rows = [openRow({ reason: "r" }), openRow({ id: "x", user_id: "other" })];
    const res = await GET();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).request).toEqual({ id: "r0", status: "open", reason: "r", requestedAt: "2026-11-01T08:00:00.000Z" });
  });

  it("null when only a cancelled request exists", async () => {
    state.rows = [openRow({ status: "cancelled" })];
    expect((await (await GET()).json()).request).toBeNull();
  });

  it("queries only the caller's rows", async () => {
    await GET();
    const q = state.ops.find((o) => o.table === "account_deletion_requests")!;
    expect(q.filters).toContainEqual(["eq", "user_id", "me"]);
  });
});

describe("DELETE", () => {
  it("cancels the caller's open request and tells the admins", async () => {
    state.rows = [openRow()];
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ request: null, cancelled: true });
    expect(state.rows[0].status).toBe("cancelled");
    expect(state.rows[0].cancelled_at).toEqual(expect.any(String));
    expect(adminSends().map((s) => s.category)).toEqual(["account_deletion_cancelled"]);
    const upd = state.ops.find((o) => o.kind === "update")!;
    expect(upd.filters).toEqual(
      expect.arrayContaining([
        ["eq", "user_id", "me"],
        ["eq", "status", "open"],
      ])
    );
  });

  it("404 when there's nothing to cancel (someone else's request is untouched)", async () => {
    state.rows = [openRow({ user_id: "other" })];
    const res = await DELETE();
    expect(res.status).toBe(404);
    expect(state.rows[0].status).toBe("open");
    expect(state.sends).toHaveLength(0);
  });
});
