import { beforeEach, describe, expect, it, vi } from "vitest";
import { todayIsoDate } from "@/lib/missio/house-churches";

// In-memory stand-in for the user client and the service-role client.
// has_org_role is the only grant. is_admin returns true on purpose: a route
// that treats an FFSA admin as a pass fails these tests by returning data.

type Row = Record<string, unknown>;

type Filter =
  | { type: "eq"; col: string; val: unknown }
  | { type: "in"; col: string; vals: unknown[] }
  | { type: "is"; col: string; val: unknown };

type Op = {
  action: "select" | "insert" | "update" | "delete";
  select?: string;
  selectOpts?: { count?: string; head?: boolean };
  payload?: Row | Row[];
  filters: Filter[];
  orders: { col: string; ascending: boolean }[];
  limit?: number;
};

type Write = { client: "user" | "admin"; table: string; op: "insert" | "update" | "delete"; payload: unknown };

const MISSIO = "11111111-1111-4111-8111-111111111111";
const FFSA = "22222222-2222-4222-8222-222222222222";
const PASTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ORG_ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const LEADER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const FFSA_ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const HOUSE_1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const HOUSE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const ADA = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const GRACE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const ALAN = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const OUTSIDE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc4";
const REVIEW = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";

const state = vi.hoisted(() => {
  const state = {
    userId: null as string | null,
    rpcError: null as { message: string } | null,
    tableError: null as string | null,
    failInsert: null as string | null,
    constraintError: null as { table: string; code: string; message: string; details?: string; hint?: string } | null,
    adminBuilds: 0,
    ops: [] as { client: "user" | "admin"; table: string; op: Op }[],
    writes: [] as Write[],
    tables: {} as Record<string, Row[]>,
    seq: 0,
    hits: new Map<string, number>(),
    limiter: {
      async hit(key: string, options: { limit: number; windowSeconds: number }) {
        const count = (state.hits.get(key) ?? 0) + 1;
        state.hits.set(key, count);
        return {
          allowed: count <= options.limit,
          remaining: Math.max(options.limit - count, 0),
          resetAt: new Date(Date.now() + options.windowSeconds * 1000),
        };
      },
    },
    userClient() {
      return makeClient("user");
    },
    adminClient() {
      return makeClient("admin");
    },
  };

  function makeClient(client: "user" | "admin") {
    return {
      auth: {
        getUser: async () => ({
          data: { user: state.userId ? { id: state.userId } : null },
          error: null,
        }),
      },
      rpc: async (fn: string, args: { p_org_slug?: string; p_roles?: string[] | null }) => {
        state.ops.push({
          client,
          table: `rpc:${fn}`,
          op: { action: "select", filters: [], orders: [], payload: args as unknown as Row },
        });
        if (fn === "is_admin") return { data: true, error: null };
        if (fn !== "has_org_role") return { data: null, error: { message: `unknown rpc ${fn}` } };
        if (state.rpcError) return { data: null, error: state.rpcError };
        return hasOrgRole(args?.p_org_slug ?? "", args?.p_roles ?? null);
      },
      from(table: string) {
        return builder(table, client);
      },
    };
  }

  function hasOrgRole(slug: string, roles: string[] | null) {
    const org = state.tables.organisations?.find((row) => row.slug === slug);
    if (!org) return { data: false, error: null };
    const mine = (state.tables.org_staff_roles ?? []).filter(
      (row) => row.user_id === state.userId && row.org_id === org.id
    );
    if (mine.length === 0) return { data: false, error: null };
    if (!roles || roles.length === 0) return { data: true, error: null };
    return { data: mine.some((row) => roles.includes(String(row.role))), error: null };
  }

  function builder(table: string, client: "user" | "admin") {
    const op: Op = { action: "select", filters: [], orders: [] };
    const b = {
      select(cols?: string, opts?: { count?: string; head?: boolean }) {
        if (op.action !== "insert" && op.action !== "update") op.action = "select";
        op.select = cols ?? "*";
        op.selectOpts = opts;
        return b;
      },
      insert(payload: Row | Row[]) {
        op.action = "insert";
        op.payload = payload;
        return b;
      },
      update(payload: Row) {
        op.action = "update";
        op.payload = payload;
        return b;
      },
      delete() {
        op.action = "delete";
        return b;
      },
      eq(col: string, val: unknown) {
        op.filters.push({ type: "eq", col, val });
        return b;
      },
      in(col: string, vals: unknown[]) {
        op.filters.push({ type: "in", col, vals });
        return b;
      },
      is(col: string, val: unknown) {
        op.filters.push({ type: "is", col, val });
        return b;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        op.orders.push({ col, ascending: opts?.ascending !== false });
        return b;
      },
      limit(n: number) {
        op.limit = n;
        return b;
      },
      maybeSingle: () => Promise.resolve(finish(true, false)),
      single: () => Promise.resolve(finish(false, true)),
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(finish(false, false)).then(resolve, reject);
      },
    };
    return b;

    function finish(maybe: boolean, single: boolean) {
      const snapshot: Op = { ...op, filters: [...op.filters], orders: [...op.orders], payload: op.payload };
      state.ops.push({ client, table, op: snapshot });
      if (state.tableError === table) {
        return { data: null, error: { message: `boom reading ${table}` }, count: null };
      }
      if (!state.tables[table]) state.tables[table] = [];
      if (op.action === "insert") return doInsert(table, client, snapshot, single);
      if (op.action === "update") return doUpdate(table, client, snapshot, maybe, single);
      if (op.action === "delete") return doDelete(table, client, snapshot);
      return doSelect(table, snapshot, maybe, single);
    }
  }

  function matches(row: Row, op: Op): boolean {
    for (const filter of op.filters) {
      if (filter.type === "eq" && row[filter.col] !== filter.val) return false;
      if (filter.type === "in" && !(filter.vals ?? []).includes(row[filter.col])) return false;
      if (filter.type === "is") {
        if (filter.val === null) {
          if (row[filter.col] != null) return false;
        } else if (row[filter.col] !== filter.val) return false;
      }
    }
    return true;
  }

  function project(row: Row, select?: string): Row {
    if (!select || select === "*") return { ...row };
    const out: Row = {};
    for (const column of select.split(",").map((col) => col.trim()).filter(Boolean)) out[column] = row[column];
    return out;
  }

  function directoryRows(): Row[] {
    return (state.tables.org_people ?? []).map((person) => {
      const contact = (state.tables.contacts ?? []).find((row) => row.id === person.contact_id);
      return {
        id: person.id,
        org_id: person.org_id,
        contact_id: person.contact_id,
        campus: person.campus,
        status: person.status,
        joined_at: person.joined_at ?? null,
        current_stage: person.current_stage ?? null,
        created_at: person.created_at,
        updated_at: person.updated_at,
        first_name: contact?.first_name ?? null,
        last_name: contact?.last_name ?? null,
        preferred_name: contact?.preferred_name ?? null,
      };
    });
  }

  function doSelect(table: string, op: Op, maybe: boolean, single: boolean) {
    const source = table === "org_people_directory" ? directoryRows() : state.tables[table];
    let rows = source.filter((row) => matches(row, op));
    const count = rows.length;
    for (const order of [...op.orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const av = a[order.col];
        const bv = b[order.col];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av > bv ? 1 : -1;
      });
      if (!order.ascending) rows.reverse();
    }
    if (op.limit != null) rows = rows.slice(0, op.limit);
    if (op.selectOpts?.head) return { data: null, error: null, count };
    const data = rows.map((row) => project(row, op.select));
    if (maybe) {
      if (data.length > 1) return { data: null, error: { message: "multiple rows" }, count };
      return { data: data[0] ?? null, error: null, count };
    }
    if (single) {
      if (data.length !== 1) return { data: null, error: { message: "row missing" }, count };
      return { data: data[0], error: null, count };
    }
    return { data, error: null, count: op.selectOpts?.count ? count : null };
  }

  function activeMember(row: Row) {
    return row.ended_at == null;
  }

  function doInsert(table: string, client: "user" | "admin", op: Op, single: boolean) {
    if (state.failInsert === table) {
      state.failInsert = null;
      return { data: null, error: { code: "XX000", message: "insert failed" }, count: null };
    }
    if (state.constraintError?.table === table) {
      const constraint = state.constraintError;
      state.constraintError = null;
      return {
        data: null,
        error: { code: constraint.code, message: constraint.message, details: constraint.details, hint: constraint.hint },
        count: null,
      };
    }
    const payloads = Array.isArray(op.payload) ? op.payload : [op.payload ?? {}];
    const inserted: Row[] = [];
    for (const payload of payloads) {
      if (table === "org_people") {
        const dup = state.tables.org_people.find(
          (row) => row.org_id === payload.org_id && row.contact_id === payload.contact_id
        );
        if (dup) return { data: null, error: { code: "23505", message: "duplicate key" }, count: null };
      }
      if (table === "house_church_members" && payload.ended_at == null) {
        const dup = state.tables.house_church_members.find(
          (row) =>
            activeMember(row) &&
            row.house_church_id === payload.house_church_id &&
            row.contact_id === payload.contact_id
        );
        if (dup) return { data: null, error: { code: "23505", message: "duplicate key" }, count: null };
      }
      if (table === "missio_import_review") {
        const dup = state.tables.missio_import_review.find(
          (row) =>
            row.org_id === payload.org_id &&
            row.source_line === payload.source_line &&
            row.raw_name === payload.raw_name
        );
        if (dup) return { data: null, error: { code: "23505", message: "duplicate key" }, count: null };
      }
      const row: Row = {
        id: payload.id ?? `${table}-${++state.seq}`,
        created_at: payload.created_at ?? "2026-04-01T00:00:00.000Z",
        updated_at: "2026-04-01T00:00:00.000Z",
        ...payload,
      };
      if (table === "contact_emails" && row.email && row.email_normalized == null) {
        row.email_normalized = String(row.email).trim().toLowerCase();
      }
      if (table === "contacts" && row.email && row.email_normalized == null) {
        row.email_normalized = String(row.email).trim().toLowerCase();
      }
      state.tables[table].push(row);
      inserted.push(row);
    }
    state.writes.push({ client, table, op: "insert", payload: payloads });
    const projected = inserted.map((row) => project(row, op.select));
    if (single) return { data: projected[0] ?? null, error: null, count: null };
    if (projected.length === 1) return { data: projected[0], error: null, count: null };
    return { data: projected, error: null, count: null };
  }

  function doUpdate(table: string, client: "user" | "admin", op: Op, maybe: boolean, single: boolean) {
    if (state.constraintError?.table === table) {
      const constraint = state.constraintError;
      state.constraintError = null;
      return {
        data: null,
        error: { code: constraint.code, message: constraint.message, details: constraint.details, hint: constraint.hint },
        count: null,
      };
    }
    const hits = state.tables[table].filter((row) => matches(row, op));
    const payload = (op.payload ?? {}) as Row;
    for (const row of hits) {
      Object.assign(row, payload, { updated_at: "2026-04-02T00:00:00.000Z" });
      if (
        table === "missio_import_review" &&
        payload.resolved_contact_id &&
        payload.resolved_at === undefined
      ) {
        row.resolved_at = "2026-11-18T08:00:00.000Z";
      }
    }
    state.writes.push({ client, table, op: "update", payload });
    const data = hits.map((row) => project(row, op.select));
    if (maybe) return { data: data[0] ?? null, error: null, count: data.length };
    if (single) {
      if (data.length !== 1) return { data: null, error: { message: "row missing" }, count: data.length };
      return { data: data[0], error: null, count: data.length };
    }
    return { data, error: null, count: data.length };
  }

  function doDelete(table: string, client: "user" | "admin", op: Op) {
    const kept: Row[] = [];
    const removed: Row[] = [];
    for (const row of state.tables[table]) {
      if (matches(row, op)) removed.push(row);
      else kept.push(row);
    }
    state.tables[table] = kept;
    state.writes.push({ client, table, op: "delete", payload: removed });
    return { data: removed, error: null, count: removed.length };
  }

  return state;
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.userClient() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    state.adminBuilds += 1;
    return state.adminClient();
  },
}));
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, getRateLimiter: () => state.limiter };
});

const { GET: listHouses } = await import("./route");
const { GET: getHouse } = await import("./[id]/route");
const { POST: postMember } = await import("./[id]/members/route");
const { PATCH: patchMember, DELETE: deleteMember } = await import("./[id]/members/[contactId]/route");
const { GET: listReview } = await import("./import-review/route");
const { POST: resolveReview } = await import("./import-review/[itemId]/resolve/route");

function reset() {
  state.userId = PASTOR;
  state.rpcError = null;
  state.tableError = null;
  state.failInsert = null;
  state.constraintError = null;
  state.adminBuilds = 0;
  state.ops = [];
  state.writes = [];
  state.seq = 0;
  state.hits.clear();
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  state.tables = {
    organisations: [
      { id: MISSIO, slug: "missio", name: "Missio", created_at: "2026-01-01T00:00:00.000Z" },
      { id: FFSA, slug: "ffsa", name: "FFSA", created_at: "2026-01-01T00:00:00.000Z" },
    ],
    org_staff_roles: [
      { id: "role-pastor", user_id: PASTOR, org_id: MISSIO, role: "pastor", campus: null },
      { id: "role-org-admin", user_id: ORG_ADMIN, org_id: MISSIO, role: "admin", campus: null },
      { id: "role-leader", user_id: LEADER, org_id: MISSIO, role: "house_church_leader", campus: "potch" },
    ],
    user_roles: [{ user_id: FFSA_ADMIN, role: "super_admin" }],
    org_people: [],
    contacts: [],
    contact_emails: [],
    contact_phones: [],
    contact_labels: [],
    house_churches: [],
    house_church_members: [],
    missio_import_review: [],
    audit_logs: [],
  };
}

function addContact(opts: {
  id?: string;
  first: string;
  last: string;
  preferred?: string | null;
  email?: string | null;
  inOrg?: boolean;
  personId?: string;
  campus?: string;
  status?: string;
}) {
  const contactId = opts.id ?? `contact-${++state.seq}`;
  state.tables.contacts.push({
    id: contactId,
    first_name: opts.first,
    last_name: opts.last,
    preferred_name: opts.preferred ?? null,
    email: opts.email ?? null,
    email_normalized: opts.email ? opts.email.trim().toLowerCase() : null,
  });
  if (opts.email) {
    state.tables.contact_emails.push({
      id: `email-${contactId}`,
      contact_id: contactId,
      email: opts.email,
      email_normalized: opts.email.trim().toLowerCase(),
      is_primary: true,
    });
  }
  if (opts.inOrg) {
    state.tables.org_people.push({
      id: opts.personId ?? `person-${contactId}`,
      org_id: MISSIO,
      contact_id: contactId,
      campus: opts.campus ?? "potch",
      status: opts.status ?? "active",
      joined_at: null,
      current_stage: null,
      created_by: PASTOR,
      created_at: "2026-02-01T00:00:00.000Z",
    });
  }
  return contactId;
}

function addHouse(opts: { id: string; number: number; name?: string | null; campus?: string; meetingDay?: string | null; location?: string | null; notes?: string | null }) {
  state.tables.house_churches.push({
    id: opts.id,
    org_id: MISSIO,
    number: opts.number,
    name: opts.name ?? null,
    campus: opts.campus ?? "potch",
    meeting_day: opts.meetingDay ?? null,
    location: opts.location ?? null,
    leader_notes: opts.notes ?? null,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
  });
}

function addMember(opts: { houseId: string; contactId: string; role: string; startedAt?: string; endedAt?: string | null; id?: string }) {
  const id = opts.id ?? `member-${++state.seq}`;
  state.tables.house_church_members.push({
    id,
    house_church_id: opts.houseId,
    contact_id: opts.contactId,
    role: opts.role,
    started_at: opts.startedAt ?? "2026-03-02",
    ended_at: opts.endedAt ?? null,
    created_by: PASTOR,
    created_at: "2026-03-02T00:00:00.000Z",
  });
  return id;
}

function addReview(opts: Partial<Row> & { id?: string; rawName: string; sourceLine: number; houseNumber: number; role?: string; status?: string }) {
  const id = opts.id ?? `review-${++state.seq}`;
  state.tables.missio_import_review.push({
    id,
    org_id: MISSIO,
    source_line: opts.sourceLine,
    raw_name: opts.rawName,
    house_number: opts.houseNumber,
    role: opts.role ?? "member",
    kind: opts.kind ?? "person",
    match_type: opts.matchType ?? opts.match_type ?? "none",
    candidate_contact_ids: opts.candidate_contact_ids ?? [],
    status: opts.status ?? "pending",
    resolved_contact_id: opts.resolved_contact_id ?? null,
    notes: opts.notes ?? null,
    resolved_by: opts.resolved_by ?? null,
    resolved_at: opts.resolved_at ?? null,
    created_at: "2026-04-01T00:00:00.000Z",
  });
  return id;
}

const list = () => listHouses(new Request("http://localhost/api/missio/house-churches"));
const detail = (id: string) =>
  getHouse(new Request(`http://localhost/api/missio/house-churches/${id}`), { params: Promise.resolve({ id }) });
const post = (id: string, body: unknown) =>
  postMember(
    new Request(`http://localhost/api/missio/house-churches/${id}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
const patch = (id: string, contactId: string, body: unknown) =>
  patchMember(
    new Request(`http://localhost/api/missio/house-churches/${id}/members/${contactId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id, contactId }) }
  );
const remove = (id: string, contactId: string) =>
  deleteMember(new Request(`http://localhost/api/missio/house-churches/${id}/members/${contactId}`, { method: "DELETE" }), {
    params: Promise.resolve({ id, contactId }),
  });
const review = (query = "") => listReview(new Request(`http://localhost/api/missio/house-churches/import-review${query}`));
const resolve = (itemId: string, body: unknown) =>
  resolveReview(
    new Request(`http://localhost/api/missio/house-churches/import-review/${itemId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ itemId }) }
  );

function seedHouses() {
  addHouse({ id: HOUSE_2, number: 12, name: "North", campus: "jhb", meetingDay: "wednesday", location: "Hall" });
  addHouse({ id: HOUSE_1, number: 3, name: "Riverside", campus: "potch", meetingDay: "tuesday", location: "Lounge", notes: "Bring a chair" });
}

beforeEach(() => {
  reset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("access on house church routes", () => {
  const routes = [
    ["GET list", () => list()],
    ["GET house", () => detail(HOUSE_1)],
    ["POST member", () => post(HOUSE_1, { contactId: ADA, role: "member" })],
    ["PATCH member", () => patch(HOUSE_1, ADA, { role: "leader" })],
    ["DELETE member", () => remove(HOUSE_1, ADA)],
    ["GET review", () => review()],
    ["POST resolve", () => resolve(REVIEW, { action: "skip" })],
  ] as const;

  it("returns 401 when there is no session", async () => {
    state.userId = null;
    seedHouses();
    for (const [, call] of routes) {
      const res = await call();
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe("unauthenticated");
    }
    expect(state.adminBuilds).toBe(0);
    expect(state.writes).toEqual([]);
    expect(state.ops.some((op) => op.table.startsWith("rpc:"))).toBe(false);
  });

  it("returns 403 for an FFSA super admin who is not a pastor, and never asks is_admin", async () => {
    state.userId = FFSA_ADMIN;
    seedHouses();
    addContact({ id: ADA, first: "Hidden", last: "Person", inOrg: true, personId: "person-ada" });
    for (const [, call] of routes) {
      const res = await call();
      const body = await res.json();
      expect(res.status).toBe(403);
      expect(body.code).toBe("forbidden");
      expect(JSON.stringify(body)).not.toContain("Hidden");
    }
    expect(state.adminBuilds).toBe(0);
    expect(state.ops.some((op) => op.table === "rpc:is_admin" || op.table === "user_roles" || op.table === "house_churches")).toBe(false);
    expect(state.writes).toEqual([]);
  });

  it("returns 403 for a Missio admin and for a house church leader", async () => {
    seedHouses();
    for (const userId of [ORG_ADMIN, LEADER]) {
      state.userId = userId;
      state.ops = [];
      const res = await list();
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("forbidden");
      const rpc = state.ops.find((op) => op.table === "rpc:has_org_role");
      expect(rpc?.op.payload).toMatchObject({ p_org_slug: "missio", p_roles: ["pastor"] });
    }
    expect(state.writes).toEqual([]);
  });

  it("asks has_org_role for pastor and does not filter a pastor down to one house", async () => {
    seedHouses();
    const res = await list();
    expect(res.status).toBe(200);
    const rpc = state.ops.find((op) => op.table === "rpc:has_org_role");
    expect(rpc?.op.payload).toMatchObject({ p_org_slug: "missio", p_roles: ["pastor"] });
    const houses = state.ops.find((op) => op.table === "house_churches" && op.op.action === "select");
    expect(houses?.op.filters.some((filter) => filter.type === "in")).toBe(false);
    expect(state.ops.some((op) => op.table === "rpc:is_admin")).toBe(false);
  });
});

describe("GET /api/missio/house-churches", () => {
  it("lists houses by number with active counts, leaders, and org person ids", async () => {
    seedHouses();
    addContact({ id: ADA, first: "Ada", last: "Lovelace", preferred: "Addie", inOrg: true, personId: "person-ada" });
    addContact({ id: GRACE, first: "Grace", last: "Hopper", inOrg: true, personId: "person-grace" });
    addContact({ id: ALAN, first: "Alan", last: "Turing", inOrg: false });
    addMember({ houseId: HOUSE_1, contactId: GRACE, role: "co_leader" });
    addMember({ houseId: HOUSE_1, contactId: ADA, role: "leader" });
    addMember({ houseId: HOUSE_1, contactId: ALAN, role: "member", endedAt: "2026-03-01" });
    addMember({ houseId: HOUSE_2, contactId: ADA, role: "member" });

    const res = await list();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.canWrite).toBe(true);
    expect(body.houses.map((house: { number: number }) => house.number)).toEqual([3, 12]);
    expect(body.houses[0]).toEqual({
      id: HOUSE_1,
      number: 3,
      name: "Riverside",
      campus: "potch",
      meetingDay: "tuesday",
      location: "Lounge",
      memberCount: 2,
      leaders: [
        {
          contactId: ADA,
          displayName: "Addie Lovelace",
          firstName: "Ada",
          lastName: "Lovelace",
          orgPersonId: "person-ada",
        },
      ],
      coLeaders: [
        {
          contactId: GRACE,
          displayName: "Grace Hopper",
          firstName: "Grace",
          lastName: "Hopper",
          orgPersonId: "person-grace",
        },
      ],
    });
    expect(body.houses[0].leaderNotes).toBeUndefined();
    expect(body.houses[1].memberCount).toBe(1);
    expect(state.ops.filter((op) => op.table === "contacts").every((op) => op.client === "admin")).toBe(true);
    expect(state.ops.some((op) => op.client === "user" && op.table === "contacts")).toBe(false);
    expect(state.ops.find((op) => op.table === "house_churches")?.client).toBe("user");
  });

  it("does not open the service role when nobody is on the wall", async () => {
    seedHouses();
    const res = await list();
    expect(res.status).toBe(200);
    expect((await res.json()).houses).toHaveLength(2);
    expect(state.adminBuilds).toBe(0);
  });

  it("counts a future end date and hides a future start", async () => {
    addHouse({ id: HOUSE_1, number: 3, name: "Riverside" });
    addContact({ id: ADA, first: "Ada", last: "Lovelace", inOrg: true, personId: "person-ada" });
    addContact({ id: GRACE, first: "Grace", last: "Hopper", inOrg: true, personId: "person-grace" });
    addMember({
      houseId: HOUSE_1,
      contactId: ADA,
      role: "member",
      startedAt: "2026-01-01",
      endedAt: "2099-01-01",
    });
    addMember({
      houseId: HOUSE_1,
      contactId: GRACE,
      role: "leader",
      startedAt: "2099-01-02",
    });

    const res = await detail(HOUSE_1);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.house.memberCount).toBe(0);
    expect(body.house.members).toEqual([]);

    expect((await post(HOUSE_1, { contactId: ADA, role: "leader" })).status).toBe(201);
    expect((await post(HOUSE_1, { contactId: GRACE, role: "member" })).status).toBe(409);

    const ended = await remove(HOUSE_1, ADA);
    expect(ended.status).toBe(200);
    expect(state.tables.house_church_members.filter((row) => row.contact_id === ADA && row.ended_at == null)).toHaveLength(0);
    expect(state.tables.house_church_members.find((row) => row.contact_id === ADA && row.role === "leader")?.ended_at).toBe(
      todayIsoDate()
    );
    expect(state.tables.org_people[0]).toMatchObject({ id: "person-ada", status: "active" });
  });

  it("hides a database error", async () => {
    state.tableError = "house_churches";
    const res = await list();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Something went wrong.", code: "server_error" });
    expect(JSON.stringify(body)).not.toContain("boom");
  });
});

describe("GET /api/missio/house-churches/:id", () => {
  it("returns the lineup sorted by role then name, and 404s when the house is missing", async () => {
    seedHouses();
    addContact({ id: ADA, first: "Zoe", last: "Leader", inOrg: true, personId: "person-ada" });
    addContact({ id: GRACE, first: "Amy", last: "Colead", inOrg: false });
    addContact({ id: ALAN, first: "Ben", last: "Member", inOrg: true, personId: "person-alan" });
    addMember({ houseId: HOUSE_1, contactId: ALAN, role: "member", startedAt: "2026-02-01" });
    addMember({ houseId: HOUSE_1, contactId: GRACE, role: "co_leader", startedAt: "2026-02-02" });
    addMember({ houseId: HOUSE_1, contactId: ADA, role: "leader", startedAt: "2026-02-03" });

    const res = await detail(HOUSE_1);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.canWrite).toBe(true);
    expect(body.house.leaderNotes).toBe("Bring a chair");
    expect(body.house.memberCount).toBe(2);
    expect(body.house.members.map((member: { contactId: string; role: string }) => [member.role, member.contactId])).toEqual([
      ["leader", ADA],
      ["member", ALAN],
    ]);
    expect(body.house.members[0].orgPersonId).toBe("person-ada");
    expect(body.house.members[1].orgPersonId).toBe("person-alan");
    expect(JSON.stringify(body)).not.toContain("Amy");

    const missing = await detail("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1");
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("not_found");
    expect((await detail("not-a-uuid")).status).toBe(404);
  });
});

describe("membership writes", () => {
  it("adds an active Missio person and does not create org_people", async () => {
    addHouse({ id: HOUSE_1, number: 3, campus: "potch" });
    addHouse({ id: HOUSE_2, number: 4, campus: "jhb" });
    addContact({ id: ADA, first: "Ada", last: "Lovelace", preferred: "Addie", inOrg: true, personId: "person-ada" });
    addContact({ id: GRACE, first: "Grace", last: "Hopper", inOrg: true, personId: "person-grace", campus: "potch", status: "visitor" });

    const created = await post(HOUSE_1, { contactId: ADA, role: "leader" });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      member: {
        contactId: ADA,
        displayName: "Addie Lovelace",
        firstName: "Ada",
        lastName: "Lovelace",
        orgPersonId: "person-ada",
        role: "leader",
        startedAt: todayIsoDate(),
      },
    });
    expect(state.writes.some((write) => write.table === "org_people")).toBe(false);
    const memberInsert = state.writes.find((write) => write.table === "house_church_members" && write.op === "insert");
    expect(memberInsert?.client).toBe("user");
    expect(memberInsert?.payload).toMatchObject([{ contact_id: ADA, role: "leader", ended_at: null, created_by: PASTOR }]);
    expect(state.writes.some((write) => write.table === "audit_logs" && write.client === "admin")).toBe(true);

    const duplicate = await post(HOUSE_1, { contactId: ADA, role: "member" });
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).code).toBe("already_member");
    expect(state.tables.house_church_members.filter((row) => row.contact_id === ADA && row.ended_at == null)).toHaveLength(1);

    const otherHouse = await post(HOUSE_2, { contactId: ADA, role: "member" });
    expect(otherHouse.status).toBe(201);
    expect(state.tables.org_people).toHaveLength(2);

    state.writes = [];
    const visitor = await post(HOUSE_2, { contactId: GRACE, role: "co_leader" });
    expect(visitor.status).toBe(201);
    expect(state.tables.org_people.find((row) => row.id === "person-grace")).toMatchObject({ status: "visitor", campus: "potch" });
    expect(state.writes.some((write) => write.table === "org_people")).toBe(false);
    expect(state.writes.some((write) => write.table === "house_church_members" && write.op === "insert")).toBe(true);
  });

  it("refuses a contact who is not in Missio and inserts nothing", async () => {
    addHouse({ id: HOUSE_1, number: 3 });
    addContact({ id: OUTSIDE, first: "Outside", last: "Person", inOrg: false });
    const before = state.tables.org_people.map((row) => ({ ...row }));

    const missing = await post(HOUSE_1, { contactId: OUTSIDE, role: "member" });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "This person is not in Missio.", code: "not_missio_person" });

    expect(state.tables.house_church_members).toEqual([]);
    expect(state.tables.org_people).toEqual(before);
    expect(state.writes.some((write) => write.op === "insert")).toBe(false);
    expect(state.ops.some((op) => op.table === "contacts")).toBe(false);
  });

  it("rejects a missing contact, a bad role, and a missing house", async () => {
    addHouse({ id: HOUSE_1, number: 3 });
    expect((await post(HOUSE_1, { contactId: OUTSIDE, role: "member" })).status).toBe(400);
    expect((await (await post(HOUSE_1, { contactId: OUTSIDE, role: "member" })).json()).code).toBe("not_missio_person");
    expect((await post(HOUSE_1, { contactId: ADA, role: "boss" })).status).toBe(400);
    expect((await post(HOUSE_1, { contactId: "nope", role: "member" })).status).toBe(400);
    expect((await post(HOUSE_1, { contactId: ADA, role: "member", extra: true })).status).toBe(400);
    addContact({ id: ADA, first: "Ada", last: "Lovelace", inOrg: true, personId: "person-ada" });
    expect((await post("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9", { contactId: ADA, role: "member" })).status).toBe(404);
    expect(state.tables.house_church_members).toEqual([]);
  });

  it("returns the same not_missio_person response for a missing contact and an FFSA-only contact", async () => {
    addHouse({ id: HOUSE_1, number: 3 });
    addContact({ id: OUTSIDE, first: "Outside", last: "Person", inOrg: false });
    const missingId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9";
    state.ops = [];
    state.writes = [];
    const missing = await post(HOUSE_1, { contactId: missingId, role: "member" });
    const missingBody = await missing.json();
    state.ops = [];
    state.writes = [];
    const outside = await post(HOUSE_1, { contactId: OUTSIDE, role: "member" });
    const outsideBody = await outside.json();
    expect(missing.status).toBe(400);
    expect(outside.status).toBe(400);
    expect(missingBody).toEqual({ error: "This person is not in Missio.", code: "not_missio_person" });
    expect(outsideBody).toEqual(missingBody);
    expect(state.ops.some((op) => op.table === "contacts")).toBe(false);
    expect(state.writes.some((write) => write.table === "org_people" || write.table === "house_church_members")).toBe(false);
    expect(state.tables.house_church_members).toEqual([]);
  });

  it("changes a role and ends a membership without touching org_people", async () => {
    addHouse({ id: HOUSE_1, number: 3 });
    addContact({ id: ADA, first: "Ada", last: "Lovelace", inOrg: true, personId: "person-ada", status: "active" });
    addMember({ id: "member-ada", houseId: HOUSE_1, contactId: ADA, role: "member" });
    const before = { ...state.tables.org_people[0] };

    const updated = await patch(HOUSE_1, ADA, { role: "leader" });
    expect(updated.status).toBe(200);
    expect((await updated.json()).member).toMatchObject({ contactId: ADA, role: "leader", orgPersonId: "person-ada" });
    expect(state.tables.house_church_members[0].role).toBe("leader");
    expect(state.tables.org_people[0]).toMatchObject(before);

    state.writes = [];
    const ended = await remove(HOUSE_1, ADA);
    expect(ended.status).toBe(200);
    expect(await ended.json()).toEqual({ ok: true });
    expect(state.tables.house_church_members[0].ended_at).toBe(todayIsoDate());
    expect(state.writes.some((write) => write.table === "house_church_members" && write.op === "delete")).toBe(false);
    expect(state.writes.some((write) => write.table === "org_people")).toBe(false);
    expect(state.tables.org_people[0]).toMatchObject({ status: "active" });

    expect((await remove(HOUSE_1, ADA)).status).toBe(404);
    expect((await patch(HOUSE_1, ADA, { role: "member" })).status).toBe(404);
    expect((await patch(HOUSE_1, "not-a-uuid", { role: "member" })).status).toBe(404);
    expect((await patch(HOUSE_1, OUTSIDE, { role: "nope" })).status).toBe(400);

    const again = await post(HOUSE_1, { contactId: ADA, role: "member" });
    expect(again.status).toBe(201);
    expect(state.tables.house_church_members.filter((row) => row.ended_at == null)).toHaveLength(1);
    expect(state.tables.house_church_members).toHaveLength(2);
    expect(state.tables.org_people).toHaveLength(1);

    state.tables.org_people[0].status = "visitor";
    const visitorRole = await patch(HOUSE_1, ADA, { role: "leader" });
    expect(visitorRole.status).toBe(200);
    expect(state.tables.org_people[0].status).toBe("visitor");
    expect(state.tables.house_church_members.find((row) => row.ended_at == null)?.role).toBe("leader");
  });

  it("returns 429 after 20 writes in a minute", async () => {
    addHouse({ id: HOUSE_1, number: 3 });
    for (let i = 0; i < 20; i++) {
      const res = await post(HOUSE_1, { role: "member" });
      expect(res.status).toBe(400);
    }
    const limited = await post(HOUSE_1, { contactId: ADA, role: "member" });
    expect(limited.status).toBe(429);
    expect((await limited.json()).code).toBe("rate_limited");
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(state.tables.house_church_members).toEqual([]);
  });

  it("returns 500 without a database message when the member row cannot be saved", async () => {
    addHouse({ id: HOUSE_1, number: 3 });
    addContact({ id: ADA, first: "Ada", last: "Lovelace", inOrg: true, personId: "person-ada" });
    state.failInsert = "house_church_members";
    const res = await post(HOUSE_1, { contactId: ADA, role: "member" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Something went wrong.", code: "server_error" });
    expect(state.tables.house_church_members).toEqual([]);
    expect(state.writes.some((write) => write.table === "org_people" && write.op === "insert")).toBe(false);
  });

  it("hard-deletes a membership that has not started", async () => {
    addHouse({ id: HOUSE_1, number: 3 });
    addContact({ id: ADA, first: "Ada", last: "Lovelace", inOrg: true, personId: "person-ada" });
    addMember({ id: "member-future", houseId: HOUSE_1, contactId: ADA, role: "member", startedAt: "2099-01-01" });
    const orgBefore = JSON.stringify(state.tables.org_people);
    const res = await remove(HOUSE_1, ADA);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(state.tables.house_church_members).toEqual([]);
    const deleted = state.writes.find((write) => write.table === "house_church_members" && write.op === "delete");
    expect(deleted?.client).toBe("admin");
    expect(state.writes.some((write) => write.table === "house_church_members" && write.op === "update")).toBe(false);
    expect(JSON.stringify(state.tables.org_people)).toBe(orgBefore);
  });

  it("closes a membership that has started by setting ended_at to today", async () => {
    addHouse({ id: HOUSE_1, number: 3 });
    addContact({ id: ADA, first: "Ada", last: "Lovelace", inOrg: true, personId: "person-ada" });
    addMember({ id: "member-ada", houseId: HOUSE_1, contactId: ADA, role: "member", startedAt: "2026-01-01" });
    const res = await remove(HOUSE_1, ADA);
    expect(res.status).toBe(200);
    expect(state.tables.house_church_members).toHaveLength(1);
    expect(state.tables.house_church_members[0].ended_at).toBe(todayIsoDate());
    expect(state.writes.some((write) => write.table === "house_church_members" && write.op === "delete")).toBe(false);
    expect(state.writes.find((write) => write.table === "house_church_members" && write.op === "update")?.client).toBe(
      "user"
    );
  });

  it("does not change org_people when someone leaves a house", async () => {
    addHouse({ id: HOUSE_1, number: 3 });
    addContact({ id: ADA, first: "Ada", last: "Lovelace", inOrg: true, personId: "person-ada", status: "visitor", campus: "jhb" });
    addMember({ houseId: HOUSE_1, contactId: ADA, role: "leader", startedAt: "2026-03-01" });
    const before = JSON.stringify(state.tables.org_people);
    const res = await remove(HOUSE_1, ADA);
    expect(res.status).toBe(200);
    expect(JSON.stringify(state.tables.org_people)).toBe(before);
    expect(state.writes.some((write) => write.table === "org_people")).toBe(false);
  });

  it("maps a future end date from the database to 409 and hides the database text", async () => {
    addHouse({ id: HOUSE_1, number: 3 });
    addContact({ id: ADA, first: "Ada", last: "Lovelace", inOrg: true, personId: "person-ada" });
    addMember({ houseId: HOUSE_1, contactId: ADA, role: "member" });
    state.constraintError = {
      table: "house_church_members",
      code: "23514",
      message: "missio_ended_at_in_future",
      details: "sheet line with Grace Hopper",
      hint: "ended_at > current_date",
    };
    const res = await remove(HOUSE_1, ADA);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ error: "That end date is after today.", code: "ended_at_in_future" });
    expect(JSON.stringify(body)).not.toContain("missio_ended_at_in_future");
    expect(JSON.stringify(body)).not.toContain("ended_at > current_date");
    expect(JSON.stringify(body)).not.toContain("sheet line with Grace Hopper");
    expect(state.tables.house_church_members[0].ended_at).toBeNull();
  });

  it.each(["missio_member_not_in_org", "missio_contact_not_in_org"])(
    "maps 23503 %s to not_missio_person and hides database text",
    async (message) => {
      addHouse({ id: HOUSE_1, number: 3 });
      addContact({ id: ADA, first: "Ada", last: "Lovelace", inOrg: true, personId: "person-ada" });
      state.constraintError = {
        table: "house_church_members",
        code: "23503",
        message,
        details: "sheet line with Grace Hopper",
        hint: "Key (contact_id) is not in org_people",
      };
      const res = await post(HOUSE_1, { contactId: ADA, role: "member" });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({ error: "This person is not in Missio.", code: "not_missio_person" });
      const text = JSON.stringify(body);
      expect(text).not.toContain(message);
      expect(text).not.toContain("Grace Hopper");
      expect(text).not.toContain("org_people");
      expect(text).not.toContain("23503");
    }
  );

  it("maps an unrecognised database error to server_error and hides the text", async () => {
    addHouse({ id: HOUSE_1, number: 3 });
    addContact({ id: ADA, first: "Ada", last: "Lovelace", inOrg: true, personId: "person-ada" });
    state.constraintError = {
      table: "house_church_members",
      code: "XX000",
      message: "sheet line with Grace Hopper",
      details: "duplicate key value violates unique constraint",
      hint: "check the raw sheet line",
    };
    const res = await post(HOUSE_1, { contactId: ADA, role: "member" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Something went wrong.", code: "server_error" });
    const text = JSON.stringify(body);
    expect(text).not.toContain("Grace Hopper");
    expect(text).not.toContain("duplicate key");
    expect(text).not.toContain("raw sheet");
    expect(text).not.toContain("XX000");
  });

  it("returns field paths for a bad member body and not the submitted value", async () => {
    addHouse({ id: HOUSE_1, number: 3 });
    const secret = "Grace Hopper sheet note";
    const res = await post(HOUSE_1, { contactId: secret, role: "nope" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_input");
    expect(body.error).toBe("Check the fields and try again.");
    expect(body.fields).toEqual(expect.arrayContaining(["contactId", "role"]));
    const text = JSON.stringify(body);
    expect(text).not.toContain(secret);
    expect(text).not.toContain("Invalid");
    expect(text).not.toContain("uuid");
  });
});

describe("import review", () => {
  it("defaults to pending and returns at most five named candidates", async () => {
    addHouse({ id: HOUSE_1, number: 3, name: "Riverside" });
    const ids = Array.from({ length: 6 }, (_, index) => `ccccccc${index}-cccc-4ccc-8ccc-ccccccccccc${index}`);
    ids.forEach((id, index) =>
      addContact({
        id,
        first: "Cand",
        last: String(index),
        inOrg: index < 4,
        personId: index < 4 ? `person-${index}` : undefined,
        status: index === 3 ? "visitor" : "active",
      })
    );
    addReview({
      id: REVIEW,
      rawName: "Someone",
      sourceLine: 2,
      houseNumber: 3,
      role: "leader",
      status: "pending",
      kind: "person",
      match_type: "multiple",
      candidate_contact_ids: ids,
      notes: "check spelling — Grace Hopper lives next door",
    });
    addReview({
      rawName: "Done",
      sourceLine: 1,
      houseNumber: 3,
      status: "skipped",
      candidate_contact_ids: [],
    });
    addReview({
      rawName: "Missing house",
      sourceLine: 9,
      houseNumber: 99,
      status: "pending",
      kind: "family_label",
      match_type: "family_label",
      candidate_contact_ids: [],
    });

    const res = await review();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((item: { rawName: string }) => item.rawName)).toEqual(["Someone", "Missing house"]);
    expect(body.items[0]).toEqual({
      id: REVIEW,
      status: "pending",
      sourceLine: 2,
      rawName: "Someone",
      matchType: "multiple",
      houseNumber: 3,
      house: { id: HOUSE_1, number: 3, name: "Riverside" },
      role: "leader",
      candidates: body.items[0].candidates,
    });
    const listed = JSON.stringify(body);
    expect(listed).not.toContain("check spelling");
    expect(listed).not.toContain("Grace Hopper");
    expect(listed).not.toContain("kind");
    expect(listed).not.toContain("notes");
    expect(body.items[0].candidates.map((candidate: { orgPersonId: string; lastName: string }) => [candidate.orgPersonId, candidate.lastName])).toEqual([
      ["person-0", "0"],
      ["person-1", "1"],
      ["person-2", "2"],
      ["person-3", "3"],
    ]);
    expect(body.items[1].house).toBeNull();
    expect(state.ops.filter((op) => op.table === "contacts").every((op) => op.client === "admin")).toBe(true);

    const all = await review("?status=all");
    expect((await all.json()).items).toHaveLength(3);
    const skipped = await review("?status=skipped");
    expect((await skipped.json()).items.map((item: { status: string }) => item.status)).toEqual(["skipped"]);
    expect((await review("?status=nope")).status).toBe(400);
  });

  it("links an active Missio person and refuses someone who is not", async () => {
    addHouse({ id: HOUSE_1, number: 3, campus: "potch" });
    addContact({ id: ADA, first: "Ada", last: "Lovelace", inOrg: true, personId: "person-ada" });
    addContact({ id: OUTSIDE, first: "Outside", last: "Person", inOrg: false });
    addReview({ id: REVIEW, rawName: "Ada Lovelace", sourceLine: 4, houseNumber: 3, role: "leader" });

    const refused = await resolve(REVIEW, { action: "link", contactId: OUTSIDE });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "This person is not in Missio.", code: "not_missio_person" });
    expect(state.tables.missio_import_review[0].status).toBe("pending");
    expect(state.tables.house_church_members).toEqual([]);
    expect(state.tables.org_people).toHaveLength(1);
    expect(state.writes.some((write) => write.table === "house_church_members" || write.table === "org_people")).toBe(false);

    const res = await resolve(REVIEW, { action: "link", contactId: ADA });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item).toMatchObject({ id: REVIEW, status: "matched", rawName: "Ada Lovelace", sourceLine: 4 });
    expect(JSON.stringify(body.item)).not.toContain("notes");
    expect(body.member).toMatchObject({ contactId: ADA, role: "leader", orgPersonId: "person-ada" });
    expect(state.tables.missio_import_review[0]).toMatchObject({
      status: "matched",
      resolved_contact_id: ADA,
      resolved_by: PASTOR,
    });
    expect(state.tables.org_people).toHaveLength(1);
    expect(state.writes.some((write) => write.table === "org_people" && write.op === "insert")).toBe(false);
    expect(state.tables.house_church_members[0]).toMatchObject({ role: "leader", ended_at: null, created_by: PASTOR });
    const reviewUpdate = state.writes.find((write) => write.table === "missio_import_review" && write.op === "update");
    expect(reviewUpdate?.client).toBe("user");
    expect(Object.keys((reviewUpdate?.payload ?? {}) as object).sort()).toEqual([
      "resolved_by",
      "resolved_contact_id",
      "status",
    ]);
    expect(reviewUpdate?.payload).not.toHaveProperty("resolved_at");
    expect((reviewUpdate?.payload as { resolved_by?: string })?.resolved_by).toBe(PASTOR);
    expect(state.writes.some((write) => write.table === "audit_logs")).toBe(true);

    state.tables.missio_import_review[0].status = "pending";
    state.tables.missio_import_review[0].resolved_contact_id = null;
    addMember({ houseId: HOUSE_1, contactId: ADA, role: "member" });
    state.tables.house_church_members.splice(0, 1);
    const kept = await resolve(REVIEW, { action: "link", contactId: ADA });
    expect(kept.status).toBe(200);
    expect((await kept.json()).member.role).toBe("member");
    expect(state.tables.house_church_members.filter((row) => row.ended_at == null)).toHaveLength(1);
    expect(state.tables.house_church_members[0].role).toBe("member");
  });

  it("creates a contact through the people path, and returns exists_use_search without resolving", async () => {
    addHouse({ id: HOUSE_1, number: 3, campus: "jhb" });
    addContact({ id: OUTSIDE, first: "Taken", last: "Person", email: "taken@example.com", inOrg: false });
    addReview({ id: REVIEW, rawName: "New Person", sourceLine: 8, houseNumber: 3, role: "member" });

    const clash = await resolve(REVIEW, {
      action: "create",
      firstName: "New",
      lastName: "Person",
      email: "taken@example.com",
    });
    expect(clash.status).toBe(409);
    expect(await clash.json()).toEqual({
      error: "This person already exists. Search by their email or phone to add them.",
      code: "exists_use_search",
    });
    expect(state.tables.missio_import_review[0].status).toBe("pending");
    expect(state.tables.house_church_members).toEqual([]);
    expect(state.tables.contacts).toHaveLength(1);

    const created = await resolve(REVIEW, {
      action: "create",
      firstName: "New",
      lastName: "Person",
      email: "new.person@example.com",
    });
    expect(created.status).toBe(200);
    const body = await created.json();
    expect(body.item.status).toBe("new");
    expect(body.member.role).toBe("member");
    expect(body.member.orgPersonId).toEqual(expect.any(String));
    expect(state.tables.contacts).toHaveLength(2);
    expect(state.tables.org_people).toHaveLength(1);
    expect(state.tables.org_people[0]).toMatchObject({ campus: "jhb", status: "active" });
    expect(state.tables.house_church_members).toHaveLength(1);
    expect(state.tables.missio_import_review[0].resolved_contact_id).toBe(body.member.contactId);
    expect(state.writes.filter((write) => write.table === "contacts" && write.op === "insert").every((write) => write.client === "admin")).toBe(true);
  });

  it("maps missio_resolve_not_allowed to not_missio_person and hides database text", async () => {
    addHouse({ id: HOUSE_1, number: 3 });
    addContact({ id: ADA, first: "Ada", last: "Lovelace", inOrg: true, personId: "person-ada" });
    addReview({ id: REVIEW, rawName: "Ada Lovelace", sourceLine: 4, houseNumber: 3, role: "leader" });
    state.constraintError = {
      table: "missio_import_review",
      code: "23503",
      message: "missio_resolve_not_allowed",
      details: "sheet line with Grace Hopper",
      hint: "resolved_contact_id is not a candidate",
    };
    const res = await resolve(REVIEW, { action: "link", contactId: ADA });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "This person is not in Missio.", code: "not_missio_person" });
    const text = JSON.stringify(body);
    expect(text).not.toContain("missio_resolve_not_allowed");
    expect(text).not.toContain("Grace Hopper");
    expect(text).not.toContain("resolved_contact_id");
    expect(state.tables.missio_import_review[0].status).toBe("pending");
  });

  it("skips without a membership and refuses a row that is already resolved", async () => {
    addHouse({ id: HOUSE_1, number: 3 });
    addReview({ id: REVIEW, rawName: "Skip me", sourceLine: 2, houseNumber: 3, candidate_contact_ids: [] });
    const skipped = await resolve(REVIEW, { action: "skip", notes: "not a person" });
    expect(skipped.status).toBe(200);
    const body = await skipped.json();
    expect(body.item).toMatchObject({ status: "skipped", rawName: "Skip me", sourceLine: 2, role: "member" });
    expect(JSON.stringify(body)).not.toContain("not a person");
    expect(state.tables.missio_import_review[0].notes).toBe("not a person");
    expect(body.member).toBeUndefined();
    expect(state.tables.house_church_members).toEqual([]);
    expect(state.tables.org_people).toEqual([]);

    const again = await resolve(REVIEW, { action: "skip" });
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe("already_resolved");
    expect(state.tables.missio_import_review[0].status).toBe("skipped");
    const writesBefore = state.writes.length;
    const raced = await resolve(REVIEW, { action: "link", contactId: OUTSIDE });
    expect(raced.status).toBe(409);
    expect((await raced.json()).code).toBe("already_resolved");
    expect(state.writes.length).toBe(writesBefore);
    expect(state.tables.house_church_members).toEqual([]);
    expect(state.tables.org_people).toEqual([]);
    expect(state.ops.filter((op) => op.table === "contacts")).toEqual([]);

    expect((await resolve(REVIEW, { action: "link" })).status).toBe(400);
    expect((await resolve(REVIEW, { action: "link", contactId: OUTSIDE })).status).toBe(409);
    expect((await resolve("not-a-uuid", { action: "skip" })).status).toBe(404);
    expect((await resolve("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2", { action: "skip" })).status).toBe(404);
  });
});
