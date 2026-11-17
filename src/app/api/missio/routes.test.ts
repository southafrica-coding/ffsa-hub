import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the two Supabase clients the Missio routes use.
// The user client can see every org_people row on purpose, so a route that
// treats an FFSA admin as a pass fails these tests by returning that row.
// The service role is only for contact matching and new contacts. org_people
// writes are recorded on the user client. contact_labels starts empty.

type Row = Record<string, unknown>;

type Filter =
  | { type: "eq"; col: string; val: unknown }
  | { type: "in"; col: string; vals: unknown[] };

type Op = {
  action: "select" | "insert" | "update" | "delete";
  select?: string;
  selectOpts?: { count?: string; head?: boolean };
  payload?: Row | Row[];
  filters: Filter[];
  ors: { expr: string; table?: string }[];
  orders: { col: string; ascending: boolean }[];
  range?: { from: number; to: number };
  limit?: number;
};

type Write = { client: "user" | "admin"; table: string; op: "insert" | "update" | "delete"; payload: unknown };

const MISSIO = "11111111-1111-4111-8111-111111111111";
const FFSA = "22222222-2222-4222-8222-222222222222";
const PASTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ORG_ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const TEAM_LEADER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const FFSA_ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const BOTH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
const JANE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const OUTSIDE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

const state = vi.hoisted(() => {
  const state = {
    userId: null as string | null,
    rpcError: null as { message: string } | null,
    tableError: null as string | null,
    adminBuilds: 0,
    ops: [] as { client: "user" | "admin"; table: string; op: Op }[],
    writes: [] as Write[],
    tables: {} as Record<string, Row[]>,
    seq: 0,
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
          op: {
            action: "select",
            filters: [],
            ors: [],
            orders: [],
            payload: args as unknown as Row,
          },
        });
        if (fn !== "has_org_role") {
          return { data: null, error: { message: `unknown rpc ${fn}` } };
        }
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
    const op: Op = { action: "select", filters: [], ors: [], orders: [] };
    const b = {
      select(cols: string, opts?: { count?: string; head?: boolean }) {
        if (op.action !== "insert" && op.action !== "update") op.action = "select";
        op.select = cols;
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
      or(expr: string, opts?: { referencedTable?: string; foreignTable?: string }) {
        op.ors.push({ expr, table: opts?.referencedTable ?? opts?.foreignTable });
        return b;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        op.orders.push({ col, ascending: opts?.ascending !== false });
        return b;
      },
      range(from: number, to: number) {
        op.range = { from, to };
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
      const snapshot: Op = {
        ...op,
        filters: [...op.filters],
        ors: [...op.ors],
        orders: [...op.orders],
        payload: op.payload,
      };
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

  function related(table: string, row: Row, name: string): Row | null {
    if (name === "organisations") {
      return state.tables.organisations.find((org) => org.id === row.org_id) ?? null;
    }
    if (name === "contacts") {
      return state.tables.contacts.find((contact) => contact.id === row.contact_id) ?? null;
    }
    return null;
  }

  function ilike(value: unknown, pattern: string): boolean {
    if (value == null) return false;
    let regex = "";
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === "\\") {
        const next = pattern[++i] ?? "";
        regex += next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      } else if (c === "%") regex += ".*";
      else if (c === "_") regex += ".";
      else regex += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${regex}$`, "i").test(String(value));
  }

  function matchesOr(row: Row, expr: string): boolean {
    const parts = expr.split(",").filter(Boolean);
    return parts.some((part) => {
      const match = part.match(/^([a-z_]+)\.(ilike|eq)\.(.*)$/i);
      if (!match) return false;
      const [, col, op, raw] = match;
      if (op.toLowerCase() === "eq") return row[col] === raw;
      return ilike(row[col], raw);
    });
  }

  function matches(table: string, row: Row, op: Op): boolean {
    for (const filter of op.filters) {
      if (filter.type === "eq" && row[filter.col] !== filter.val) return false;
      if (filter.type === "in" && !(filter.vals ?? []).includes(row[filter.col])) return false;
    }
    for (const clause of op.ors) {
      const target = clause.table ? related(table, row, clause.table) : row;
      if (!target || !matchesOr(target, clause.expr)) return false;
    }
    return true;
  }

  function project(table: string, row: Row, select?: string): Row {
    if (!select || select === "*") return { ...row };
    const embeds: { name: string; columns: string[]; inner: boolean }[] = [];
    const stripped = select.replace(/(\w+)(?:!\w+)?\(([^)]*)\)/g, (_all, name, cols) => {
      embeds.push({
        name,
        columns: String(cols)
          .split(",")
          .map((col) => col.trim())
          .filter(Boolean),
        inner: select.includes(`${name}!inner`),
      });
      return "";
    });
    const columns = stripped
      .split(",")
      .map((col) => col.trim())
      .filter(Boolean);
    const out: Row = {};
    for (const column of columns) out[column] = row[column];
    for (const embed of embeds) {
      const rel = related(table, row, embed.name);
      if (!rel) {
        out[embed.name] = null;
        continue;
      }
      const shaped: Row = {};
      for (const column of embed.columns) shaped[column] = rel[column];
      out[embed.name] = shaped;
    }
    return out;
  }

  function doSelect(table: string, op: Op, maybe: boolean, single: boolean) {
    let rows = state.tables[table].filter((row) => matches(table, row, op));
    if (op.select?.includes("!inner")) {
      rows = rows.filter((row) => {
        const embedNames = [...op.select!.matchAll(/(\w+)!inner\(/g)].map((match) => match[1]);
        return embedNames.every((name) => related(table, row, name));
      });
    }
    const count = rows.length;
    for (const order of [...op.orders].reverse()) {
      rows.sort((a, b) => {
        const av = a[order.col];
        const bv = b[order.col];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av > bv ? 1 : -1;
      });
      if (!order.ascending) rows.reverse();
    }
    if (op.range) rows = rows.slice(op.range.from, op.range.to + 1);
    if (op.limit != null) rows = rows.slice(0, op.limit);
    if (op.selectOpts?.head) return { data: null, error: null, count };
    const data = rows.map((row) => project(table, row, op.select));
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

  function doInsert(table: string, client: "user" | "admin", op: Op, single: boolean) {
    const payloads = Array.isArray(op.payload) ? op.payload : [op.payload ?? {}];
    const inserted: Row[] = [];
    for (const payload of payloads) {
      if (table === "org_people") {
        const dup = state.tables.org_people.find(
          (row) => row.org_id === payload.org_id && row.contact_id === payload.contact_id
        );
        if (dup) {
          return {
            data: null,
            error: { code: "23505", message: "duplicate key value violates unique constraint" },
            count: null,
          };
        }
      }
      const row: Row = {
        id: payload.id ?? `${table}-${++state.seq}`,
        created_at: payload.created_at ?? "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
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
    const projected = inserted.map((row) => project(table, row, op.select));
    if (single) return { data: projected[0] ?? null, error: null, count: null };
    return { data: projected, error: null, count: null };
  }

  function doUpdate(table: string, client: "user" | "admin", op: Op, maybe: boolean, single: boolean) {
    const hits = state.tables[table].filter((row) => matches(table, row, op));
    const payload = (op.payload ?? {}) as Row;
    for (const row of hits) Object.assign(row, payload, { updated_at: "2026-01-02T00:00:00.000Z" });
    state.writes.push({ client, table, op: "update", payload });
    const data = hits.map((row) => project(table, row, op.select));
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
      if (matches(table, row, op)) removed.push(row);
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

const { GET: getMe } = await import("./me/route");
const { GET: getPeople, POST: postPeople } = await import("./people/route");
const { PATCH: patchPerson } = await import("./people/[id]/route");
const { GET: searchContacts } = await import("./contacts/search/route");

function reset() {
  state.userId = PASTOR;
  state.rpcError = null;
  state.tableError = null;
  state.adminBuilds = 0;
  state.ops = [];
  state.writes = [];
  state.seq = 0;
  state.tables = {
    organisations: [
      { id: MISSIO, slug: "missio", name: "Missio", contact_label_id: "label-missio", created_at: "2026-01-01T00:00:00.000Z" },
      { id: FFSA, slug: "ffsa", name: "FFSA", contact_label_id: "label-ffsa", created_at: "2026-01-01T00:00:00.000Z" },
    ],
    org_staff_roles: [
      { id: "role-pastor", user_id: PASTOR, org_id: MISSIO, role: "pastor", campus: null },
      { id: "role-org-admin", user_id: ORG_ADMIN, org_id: MISSIO, role: "admin", campus: null },
      { id: "role-tl", user_id: TEAM_LEADER, org_id: MISSIO, role: "team_leader", campus: "potch" },
      { id: "role-both-ffsa", user_id: BOTH, org_id: FFSA, role: "admin", campus: null },
      { id: "role-both-missio", user_id: BOTH, org_id: MISSIO, role: "pastor", campus: "jhb" },
    ],
    org_people: [],
    contacts: [],
    contact_emails: [],
    contact_phones: [],
    contact_labels: [],
  };
}

function addContact(opts: {
  id?: string;
  first: string;
  last: string;
  preferred?: string | null;
  email?: string | null;
  phone?: string | null;
  phoneNormalized?: string | null;
  inOrg?: boolean;
  personId?: string;
  campus?: string;
  status?: string;
  joinedAt?: string | null;
  stage?: string | null;
  createdAt?: string;
}) {
  const contactId = opts.id ?? `contact-${++state.seq}`;
  state.tables.contacts.push({
    id: contactId,
    first_name: opts.first,
    last_name: opts.last,
    preferred_name: opts.preferred ?? null,
    email: opts.email ?? null,
    phone: opts.phone ?? null,
    email_normalized: opts.email ? opts.email.trim().toLowerCase() : null,
    phone_normalized: opts.phoneNormalized ?? opts.phone ?? null,
  });
  if (opts.email) {
    state.tables.contact_emails.push({
      id: `email-${contactId}`,
      contact_id: contactId,
      email: opts.email,
      email_normalized: opts.email.trim().toLowerCase(),
      is_primary: true,
      label: "primary",
    });
  }
  if (opts.phone) {
    state.tables.contact_phones.push({
      id: `phone-${contactId}`,
      contact_id: contactId,
      phone: opts.phone,
      phone_normalized: opts.phoneNormalized ?? opts.phone,
      is_primary: true,
      label: "primary",
    });
  }
  if (opts.inOrg !== false) {
    state.tables.org_people.push({
      id: opts.personId ?? `person-${contactId}`,
      org_id: MISSIO,
      contact_id: contactId,
      campus: opts.campus ?? "potch",
      status: opts.status ?? "active",
      joined_at: opts.joinedAt ?? null,
      current_stage: opts.stage ?? null,
      created_by: PASTOR,
      created_at: opts.createdAt ?? "2026-02-01T00:00:00.000Z",
    });
  }
  return contactId;
}

const get = (path: string) => getPeople(new Request(`http://localhost${path}`));
const search = (q: string) =>
  searchContacts(new Request(`http://localhost/api/missio/contacts/search?q=${encodeURIComponent(q)}`));
const post = (body: unknown) =>
  postPeople(
    new Request("http://localhost/api/missio/people", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  );
const patch = (id: string, body: unknown) =>
  patchPerson(
    new Request(`http://localhost/api/missio/people/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id }) }
  );

beforeEach(() => {
  reset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/missio/me", () => {
  it("refuses someone who is signed out", async () => {
    state.userId = null;
    const res = await getMe();
    expect(res.status).toBe(401);
    expect(state.ops.some((op) => op.table.startsWith("rpc:"))).toBe(false);
  });

  it("returns an empty membership for a signed-in FFSA admin with no org role", async () => {
    state.userId = FFSA_ADMIN;
    const res = await getMe();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgs: [], rolesByOrg: {}, currentOrg: null });
  });

  it("lists the caller's orgs and marks Missio current when they hold any Missio role", async () => {
    state.userId = BOTH;
    const res = await getMe();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.currentOrg).toBe("missio");
    expect(body.orgs).toEqual(
      expect.arrayContaining([
        { id: MISSIO, slug: "missio", name: "Missio" },
        { id: FFSA, slug: "ffsa", name: "FFSA" },
      ])
    );
    expect(body.rolesByOrg.missio).toEqual(["pastor"]);
    expect(body.rolesByOrg.ffsa).toEqual(["admin"]);
  });

  it("fails closed when the membership read errors", async () => {
    state.tableError = "org_staff_roles";
    const res = await getMe();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("boom reading");
    expect(body.orgs).toBeUndefined();
  });
});

describe("access on every Missio data route", () => {
  const routes = [
    ["GET people", () => get("/api/missio/people")],
    ["GET search", () => search("jane@gmail.com")],
    ["POST people", () => post({ name: "A Person", email: "a@example.com" })],
    ["PATCH people", () => patch("person-1", { campus: "jhb" })],
  ] as const;

  it("returns 401 when there is no session", async () => {
    state.userId = null;
    for (const [, call] of routes) {
      expect((await call()).status).toBe(401);
    }
    expect(state.adminBuilds).toBe(0);
    expect(state.writes).toEqual([]);
  });

  it("returns 403 for an FFSA admin who has no org role", async () => {
    state.userId = FFSA_ADMIN;
    addContact({ first: "Hidden", last: "Person", email: "hidden@example.com", personId: "person-hidden" });
    for (const [, call] of routes) {
      const res = await call();
      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).not.toContain("Hidden");
    }
    expect(state.adminBuilds).toBe(0);
    expect(state.ops.some((op) => op.table === "org_people" || op.table === "contacts" || op.table === "contact_emails")).toBe(
      false
    );
    expect(state.writes).toEqual([]);
  });

  it("lets a pastor through the reads", async () => {
    addContact({ first: "Ada", last: "Lovelace", email: "ada@example.com", personId: "person-ada" });
    expect((await get("/api/missio/people")).status).toBe(200);
    expect((await search("ada@example.com")).status).toBe(200);
  });

  it("lets an org admin through the reads", async () => {
    state.userId = ORG_ADMIN;
    addContact({ first: "Ada", last: "Lovelace", email: "ada@example.com" });
    expect((await get("/api/missio/people")).status).toBe(200);
  });

  it("refuses a non-pastor org role on writes and on the people list", async () => {
    state.userId = TEAM_LEADER;
    addContact({ first: "Ada", last: "Lovelace", email: "ada@example.com", personId: "person-ada" });
    expect((await get("/api/missio/people")).status).toBe(403);
    expect((await search("ada@example.com")).status).toBe(403);
    expect((await post({ name: "A Person", email: "a@example.com" })).status).toBe(403);
    expect((await patch("person-ada", { status: "inactive" })).status).toBe(403);
    expect(state.writes).toEqual([]);
    expect(state.adminBuilds).toBe(0);
  });

  it("fails closed when has_org_role errors", async () => {
    state.rpcError = { message: "connection refused" };
    addContact({ first: "Ada", last: "Lovelace", personId: "person-ada" });
    const res = await get("/api/missio/people");
    expect([403, 500]).toContain(res.status);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("connection refused");
    expect(body.rows).toBeUndefined();
    expect(state.ops.some((op) => op.table === "org_people")).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it("asks has_org_role for pastor or org admin, and does not ask about FFSA roles", async () => {
    await get("/api/missio/people");
    const rpc = state.ops.find((op) => op.table === "rpc:has_org_role");
    expect(rpc?.op.payload).toMatchObject({
      p_org_slug: "missio",
      p_roles: ["pastor", "admin"],
    });
    expect(state.ops.some((op) => op.table === "rpc:is_admin" || op.table === "user_roles")).toBe(false);
  });
});

describe("GET /api/missio/people", () => {
  it("filters by campus and status and pages with a default limit of 50", async () => {
    addContact({ first: "Potch", last: "One", personId: "p1", campus: "potch", status: "active", createdAt: "2026-03-03T00:00:00.000Z" });
    addContact({ first: "Potch", last: "Two", personId: "p2", campus: "potch", status: "visitor", createdAt: "2026-03-02T00:00:00.000Z" });
    addContact({ first: "Joburg", last: "One", personId: "j1", campus: "jhb", status: "active", createdAt: "2026-03-01T00:00:00.000Z" });

    const res = await get("/api/missio/people?campus=potch&status=active");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.rows).toEqual([
      {
        id: "p1",
        contactId: expect.any(String),
        name: "Potch One",
        campus: "potch",
        status: "active",
        joinedAt: null,
        currentStage: null,
      },
    ]);
    expect(state.adminBuilds).toBe(0);
    expect(state.ops.find((op) => op.table === "org_people")?.client).toBe("user");

    state.ops = [];
    const paged = await get("/api/missio/people?limit=1&offset=1");
    const page = await paged.json();
    expect(page.total).toBe(3);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].id).toBe("p2");
    const list = state.ops.find((op) => op.table === "org_people" && op.op.range);
    expect(list?.op.range).toEqual({ from: 1, to: 1 });

    state.ops = [];
    await get("/api/missio/people");
    expect(state.ops.find((op) => op.table === "org_people")?.op.range).toEqual({ from: 0, to: 49 });
  });

  it("rejects an unknown campus, status, or an oversized limit", async () => {
    expect((await get("/api/missio/people?campus=cpt")).status).toBe(400);
    expect((await get("/api/missio/people?status=deleted")).status).toBe(400);
    expect((await get("/api/missio/people?limit=201")).status).toBe(400);
    expect((await get("/api/missio/people?limit=0")).status).toBe(400);
    expect((await get("/api/missio/people?offset=-1")).status).toBe(400);
    expect(state.ops.some((op) => op.table === "org_people")).toBe(false);
  });

  it("matches the name only, and escapes ilike wildcards", async () => {
    addContact({
      id: "c-percent",
      first: "100%",
      last: "Full",
      personId: "percent",
      email: "percent@example.com",
    });
    addContact({
      id: "c-ann",
      first: "Ann",
      last: "Other",
      personId: "ann",
      email: "ann@example.com",
      preferred: "Annie",
    });
    addContact({
      id: "c-jane",
      first: "Jane",
      last: "Mail",
      personId: "jane",
      email: "jane@gmail.com",
    });

    const literal = await get("/api/missio/people?q=%25");
    expect(literal.status).toBe(200);
    expect((await literal.json()).rows.map((row: { id: string }) => row.id)).toEqual(["percent"]);

    const underscore = await get("/api/missio/people?q=_");
    expect((await underscore.json()).rows).toEqual([]);

    const fullName = await get("/api/missio/people?q=Jane%20Mail");
    expect((await fullName.json()).rows.map((row: { name: string }) => row.name)).toEqual(["Jane Mail"]);

    const byEmail = await get("/api/missio/people?q=jane%40gmail.com");
    expect((await byEmail.json()).rows).toEqual([]);
    expect(state.ops.some((op) => op.table === "contact_emails" || op.table === "contact_phones")).toBe(false);
  });
});

describe("GET /api/missio/contacts/search", () => {
  it("rejects a plain name before looking anyone up", async () => {
    addContact({ first: "Jane", last: "Mail", email: "jane@gmail.com", inOrg: false });
    const res = await search("Jane Mail");
    expect(res.status).toBe(400);
    expect(state.adminBuilds).toBe(0);
    expect(state.ops.some((op) => op.table === "contact_emails" || op.table === "contacts")).toBe(false);
  });

  it("exact-matches an email or a phone, masks them, and caps the list at 5", async () => {
    addContact({
      id: JANE,
      first: "Jane",
      last: "Mail",
      email: "jane@gmail.com",
      phone: "+27821234567",
      phoneNormalized: "+27821234567",
      inOrg: true,
      personId: "person-jane",
    });
    addContact({
      id: OUTSIDE,
      first: "Jon",
      last: "Outside",
      email: "jon@example.com",
      phone: "+27820000000",
      phoneNormalized: "+27820000000",
      inOrg: false,
    });

    const email = await search("  Jane@Gmail.com ");
    expect(email.status).toBe(200);
    const emailBody = await email.json();
    expect(emailBody.matches).toEqual([
      {
        contactId: JANE,
        name: "Jane Mail",
        maskedEmail: "j***@g***.com",
        maskedPhone: "*** *** 4567",
        alreadyInOrg: true,
      },
    ]);
    const raw = JSON.stringify(emailBody);
    expect(raw).not.toContain("jane@gmail.com");
    expect(raw).not.toContain("+27821234567");
    expect(raw).not.toContain("27821234567");
    const emailOp = state.ops.find((op) => op.table === "contact_emails");
    expect(emailOp?.client).toBe("admin");
    expect(emailOp?.op.filters).toContainEqual({ type: "eq", col: "email_normalized", val: "jane@gmail.com" });

    state.ops = [];
    const phone = await search("082 000 0000");
    expect(phone.status).toBe(200);
    const phoneBody = await phone.json();
    expect(phoneBody.matches).toEqual([
      expect.objectContaining({
        contactId: OUTSIDE,
        maskedPhone: "*** *** 0000",
        alreadyInOrg: false,
      }),
    ]);
    expect(JSON.stringify(phoneBody)).not.toContain("+27820000000");
    expect(state.ops.find((op) => op.table === "contact_phones")?.op.filters).toContainEqual({
      type: "eq",
      col: "phone_normalized",
      val: "+27820000000",
    });

    for (let i = 0; i < 6; i++) {
      addContact({
        id: `crowd-${i}`,
        first: "Crowd",
        last: String(i),
        email: "crowd@example.com",
        inOrg: false,
      });
    }
    const crowd = await search("crowd@example.com");
    expect(crowd.status).toBe(200);
    expect((await crowd.json()).matches).toHaveLength(5);
  });
});

describe("POST /api/missio/people", () => {
  it("rejects a contact id whose email or phone does not match", async () => {
    const contactId = addContact({ id: JANE, first: "Jane", last: "Mail", email: "jane@gmail.com", phone: "+27821234567", phoneNormalized: "+27821234567", inOrg: false });
    expect((await post({ contactId, matchedBy: { email: "other@gmail.com" } })).status).toBe(400);
    expect((await post({ contactId, matchedBy: { phone: "0820000000" } })).status).toBe(400);
    expect(state.tables.org_people).toEqual([]);
    expect(state.writes.filter((write) => write.table === "org_people")).toEqual([]);
    expect(state.tables.contacts).toHaveLength(1);
  });

  it("links an existing contact when the create form matches one, and does not insert another", async () => {
    const contactId = addContact({
      id: JANE,
      first: "Jane",
      last: "Mail",
      email: "jane@gmail.com",
      inOrg: false,
    });
    const res = await post({ name: "Someone Else", email: "Jane@Gmail.com", phone: "0821234567" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.linkedExisting).toBe(true);
    expect(body.person).toMatchObject({
      contactId,
      name: "Jane Mail",
      campus: "potch",
      status: "active",
    });
    expect(state.tables.contacts).toHaveLength(1);
    expect(state.writes.filter((write) => write.table === "contacts")).toEqual([]);
    expect(state.writes.find((write) => write.table === "org_people")?.client).toBe("admin");
    expect(state.tables.org_people[0]).toMatchObject({
      contact_id: contactId,
      org_id: MISSIO,
      created_by: PASTOR,
      campus: "potch",
    });
  });

  it("creates the contact and its email and phone only when nothing matches", async () => {
    const res = await post({
      name: "New Person",
      email: "new@example.com",
      phone: "0821234567",
      campus: "jhb",
      status: "visitor",
      joinedAt: "2024-05-01",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.linkedExisting).toBe(false);
    expect(body.person).toMatchObject({
      name: "New Person",
      campus: "jhb",
      status: "visitor",
      joinedAt: "2024-05-01",
      currentStage: null,
    });
    expect(state.writes.find((write) => write.table === "contacts")).toMatchObject({ client: "admin" });
    expect(state.tables.contacts).toHaveLength(1);
    expect(state.tables.contact_emails[0]).toMatchObject({
      email_normalized: "new@example.com",
      is_primary: true,
    });
    expect(state.tables.contact_phones[0]).toMatchObject({ phone_normalized: "+27821234567" });
    expect(state.writes.find((write) => write.table === "org_people" && write.op === "insert")?.client).toBe("admin");
    const contactInsert = state.writes.find((write) => write.table === "contacts" && write.op === "insert");
    const contactPayload = Array.isArray(contactInsert?.payload) ? contactInsert?.payload[0] : contactInsert?.payload;
    expect(contactPayload).not.toHaveProperty("campus");
    expect(contactPayload).not.toHaveProperty("status");
    expect(contactPayload).not.toHaveProperty("current_stage");
    expect(contactPayload).not.toHaveProperty("currentStage");
    expect(state.tables.org_people[0]).toMatchObject({
      org_id: MISSIO,
      created_by: PASTOR,
      campus: "jhb",
      status: "visitor",
    });
    expect(state.writes.filter((write) => write.table === "contact_labels")).toEqual([]);
    expect(state.tables.contact_labels).toEqual([]);
    expect(state.ops.some((op) => op.table === "contact_labels")).toBe(false);
  });

  it("links by the verified contact id", async () => {
    const contactId = addContact({
      id: JANE,
      first: "Jane",
      last: "Mail",
      email: "jane@gmail.com",
      inOrg: false,
    });
    const res = await post({
      contactId,
      matchedBy: { email: "jane@gmail.com" },
      campus: "jhb",
      status: "visitor",
      joinedAt: "2024-01-02",
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      person: { contactId, name: "Jane Mail", campus: "jhb", status: "visitor", joinedAt: "2024-01-02" },
    });
    expect(state.tables.contacts).toHaveLength(1);
  });

  it("returns 409 when the contact is already in the org", async () => {
    const contactId = addContact({ id: JANE, first: "Jane", last: "Mail", email: "jane@gmail.com", inOrg: true, personId: "person-jane" });
    const res = await post({ contactId, matchedBy: { email: "jane@gmail.com" } });
    expect(res.status).toBe(409);
    expect(state.tables.org_people).toHaveLength(1);

    const again = await post({ name: "Jane Mail", email: "jane@gmail.com" });
    expect(again.status).toBe(409);
    expect(state.tables.org_people).toHaveLength(1);
    expect(state.tables.contacts).toHaveLength(1);
  });

  it("rejects a body with no identifier, an unknown field, or a bad campus", async () => {
    expect((await post({ name: "No Id" })).status).toBe(400);
    expect((await post({ name: "Bad", email: "new@example.com", created_by: "someone-else" })).status).toBe(400);
    expect((await post({ name: "Bad", email: "new@example.com", campus: "cpt" })).status).toBe(400);
    expect((await post({ contactId: "not-a-uuid", matchedBy: { email: "a@b.com" } })).status).toBe(400);
    expect(state.writes).toEqual([]);
  });
});

describe("PATCH /api/missio/people/[id]", () => {
  it("updates the fields a pastor sent", async () => {
    addContact({
      first: "Ada",
      last: "Lovelace",
      personId: "person-ada",
      campus: "potch",
      status: "active",
      joinedAt: "2020-01-01",
      stage: "welcome",
    });
    const res = await patch("person-ada", { campus: "jhb", status: "inactive" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      person: {
        id: "person-ada",
        name: "Ada Lovelace",
        campus: "jhb",
        status: "inactive",
        joinedAt: "2020-01-01",
        currentStage: "welcome",
      },
    });
    expect(state.writes[0]).toMatchObject({ client: "user", table: "org_people", op: "update" });
    expect(state.adminBuilds).toBe(0);
  });

  it("rejects an empty body, an unknown field, and a bad value", async () => {
    addContact({ first: "Ada", last: "Lovelace", personId: "person-ada" });
    expect((await patch("person-ada", {})).status).toBe(400);
    expect((await patch("person-ada", { name: "Changed" })).status).toBe(400);
    expect((await patch("person-ada", { campus: "cpt" })).status).toBe(400);
    expect((await patch("person-ada", { joinedAt: "tomorrow" })).status).toBe(400);
    expect((await patch("person-ada", { campus: "jhb", contact_id: JANE })).status).toBe(400);
    expect((await patch("person-ada", { status: "inactive", org_id: MISSIO })).status).toBe(400);
    expect(state.writes).toEqual([]);
    expect(state.tables.org_people[0].campus).toBe("potch");
  });

  it("returns 404 when the person is not visible", async () => {
    const res = await patch("33333333-3333-4333-8333-333333333333", { status: "inactive" });
    expect(res.status).toBe(404);
    expect(state.tables.org_people).toEqual([]);
  });

  it("clears joinedAt and currentStage when the body sends null", async () => {
    addContact({
      first: "Ada",
      last: "Lovelace",
      personId: "person-ada",
      joinedAt: "2020-01-01",
      stage: "welcome",
    });
    const res = await patch("person-ada", { joinedAt: null, currentStage: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      person: { joinedAt: null, currentStage: null },
    });
  });
});
