import { beforeEach, describe, expect, it, vi } from "vitest";
import { FOLLOWUP_LIST_INCLUDES_CONTACT_PII } from "@/lib/missio/follow-up";

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

const MISSIO = "11111111-1111-4111-8111-111111111111";
const PASTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const PASTOR_OUTSIDE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const ORG_ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const FFSA_ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const HOUSE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const ADA = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const GRACE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const OUTSIDE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const VEE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc4";
const MEMBER = "cccccccc-cccc-4ccc-8ccc-ccccccccccc5";
const ENDED = "cccccccc-cccc-4ccc-8ccc-ccccccccccc6";
const CARD = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const CARD_VEE = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const CARD_OUT = "dddddddd-dddd-4ddd-8ddd-ddddddddddd3";
const FOLLOW = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";

const state = vi.hoisted(() => {
  const state = {
    userId: null as string | null,
    tableError: null as string | null,
    writes: [] as {
      client: "user" | "admin";
      table: string;
      op: string;
      payload: unknown;
      filters?: Filter[];
    }[],
    reads: [] as { client: "user" | "admin"; table: string }[],
    conflictTable: null as string | null,
    duplicateFollowup: false,
    tables: {} as Record<string, Row[]>,
    hits: new Map<string, number>(),
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
        if (fn === "is_admin") return { data: true, error: null };
        if (fn !== "has_org_role") return { data: null, error: { message: `unknown rpc ${fn}` } };
        const org = state.tables.organisations?.find((row) => row.slug === args?.p_org_slug);
        if (!org) return { data: false, error: null };
        const mine = (state.tables.org_staff_roles ?? []).filter(
          (row) => row.user_id === state.userId && row.org_id === org.id
        );
        if (mine.length === 0) return { data: false, error: null };
        const roles = args?.p_roles ?? null;
        if (!roles || roles.length === 0) return { data: true, error: null };
        return { data: mine.some((row) => roles.includes(String(row.role))), error: null };
      },
      from(table: string) {
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
          if (client === "admin") state.reads.push({ client, table });
          if (state.tableError === table) {
            return { data: null, error: { code: "XX000", message: `boom reading ${table}` }, count: null };
          }
          if (!state.tables[table]) state.tables[table] = [];
          if (op.action === "insert") return writeInsert(table, client, op, single);
          if (op.action === "update") return writeUpdate(table, client, op, maybe);
          return writeSelect(table, op, maybe, single);
        }
      },
    };
  }

  function matches(row: Row, op: Op) {
    return op.filters.every((filter) => {
      if (filter.type === "eq") return row[filter.col] === filter.val;
      if (filter.type === "in") return (filter.vals ?? []).includes(row[filter.col]);
      if (filter.type === "is") return filter.val === null ? row[filter.col] == null : row[filter.col] === filter.val;
      return true;
    });
  }

  function sourceRows(table: string): Row[] {
    if (table === "org_people_directory") {
      return (state.tables.org_people ?? []).map((person) => {
        const contact = (state.tables.contacts ?? []).find((row) => row.id === person.contact_id);
        return {
          ...person,
          first_name: contact?.first_name ?? null,
          last_name: contact?.last_name ?? null,
          preferred_name: contact?.preferred_name ?? null,
        };
      });
    }
    if (table === "missio_followup_effective") {
      return (state.tables.missio_followups ?? []).map((row) => ({
        ...row,
        effective_stage: row.effective_stage ?? row.stage,
      }));
    }
    return state.tables[table] ?? [];
  }

  function project(row: Row, select?: string): Row {
    if (!select || select.trim() === "*") return { ...row };
    const out: Row = {};
    for (const column of select.split(",").map((col) => col.trim()).filter(Boolean)) out[column] = row[column];
    return out;
  }

  function writeSelect(table: string, op: Op, maybe: boolean, single: boolean) {
    let rows = sourceRows(table).filter((row) => matches(row, op));
    for (const order of [...op.orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const av = a[order.col];
        const bv = b[order.col];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return String(av) > String(bv) ? 1 : -1;
      });
      if (!order.ascending) rows.reverse();
    }
    const count = rows.length;
    if (op.limit != null) rows = rows.slice(0, op.limit);
    if (op.selectOpts?.head) return { data: null, error: null, count };
    const data = rows.map((row) => project(row, op.select));
    if (maybe) return { data: data[0] ?? null, error: data.length > 1 ? { message: "multiple rows" } : null, count };
    if (single) return { data: data[0] ?? null, error: data.length === 1 ? null : { message: "row missing" }, count };
    return { data, error: null, count };
  }

  function writeInsert(table: string, client: "user" | "admin", op: Op, single: boolean) {
    if (table === "missio_followups" && state.duplicateFollowup) {
      state.duplicateFollowup = false;
      state.writes.push({ client, table, op: "insert", payload: op.payload, filters: op.filters });
      return { data: null, error: { code: "23505", message: "duplicate key" }, count: null };
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
      const row: Row = {
        id: payload.id ?? `${table}-${++state.seq}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...payload,
      };
      if (table === "missio_followup_stage_history" && !Object.prototype.hasOwnProperty.call(payload, "changed_by")) {
        row.changed_by = state.userId;
      }
      if (table === "missio_followup_stage_history" && row.changed_at == null) {
        row.changed_at = new Date().toISOString();
      }
      if (table === "contact_emails" && row.email && row.email_normalized == null) {
        row.email_normalized = String(row.email).trim().toLowerCase();
      }
      if (table === "contact_phones" && row.phone && row.phone_normalized == null) {
        row.phone_normalized = String(row.phone);
      }
      state.tables[table].push(row);
      inserted.push(row);
    }
    state.writes.push({ client, table, op: "insert", payload: payloads.length === 1 ? payloads[0] : payloads, filters: op.filters });
    const data = inserted.map((row) => project(row, op.select));
    if (single || data.length === 1) return { data: data[0] ?? null, error: null, count: null };
    return { data, error: null, count: null };
  }

  function writeUpdate(table: string, client: "user" | "admin", op: Op, maybe: boolean) {
    const payload = (op.payload ?? {}) as Row;
    if (state.conflictTable === table) {
      state.conflictTable = null;
      state.writes.push({ client, table, op: "update", payload, filters: op.filters });
      return { data: null, error: null, count: 0 };
    }
    const hits = (state.tables[table] ?? []).filter((row) => matches(row, op));
    for (const row of hits) Object.assign(row, payload, { updated_at: "2026-11-18T00:00:00.000Z" });
    state.writes.push({ client, table, op: "update", payload, filters: op.filters });
    const data = hits.map((row) => project(row, op.select));
    if (maybe) return { data: data[0] ?? null, error: null, count: data.length };
    return { data, error: null, count: data.length };
  }

  return state;
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.userClient() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.adminClient() }));
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return {
    ...actual,
    getRateLimiter: () => ({
      async hit(key: string, options: { limit: number; windowSeconds: number }) {
        const count = (state.hits.get(key) ?? 0) + 1;
        state.hits.set(key, count);
        return {
          allowed: count <= options.limit,
          remaining: Math.max(options.limit - count, 0),
          resetAt: new Date(Date.now() + options.windowSeconds * 1000),
        };
      },
    }),
  };
});

const { GET: listPeople } = await import("./route");
const { GET: listLeaders } = await import("./leaders/route");
const { PATCH: patchStage } = await import("./[key]/stage/route");
const { PATCH: patchLeader } = await import("./[key]/leader/route");
const { GET: getTimeline, POST: postTimeline } = await import("./[key]/timeline/route");
const { POST: postContact } = await import("./[key]/contact/route");

function reset() {
  state.userId = PASTOR;
  state.tableError = null;
  state.writes = [];
  state.reads = [];
  state.conflictTable = null;
  state.duplicateFollowup = false;
  state.hits = new Map();
  state.seq = 0;
  state.tables = {
    organisations: [{ id: MISSIO, slug: "missio", name: "Missio" }],
    org_staff_roles: [
      { user_id: PASTOR, org_id: MISSIO, role: "pastor" },
      { user_id: PASTOR_OUTSIDE, org_id: MISSIO, role: "pastor" },
      { user_id: ORG_ADMIN, org_id: MISSIO, role: "admin" },
    ],
    users: [
      { id: PASTOR, display_name: "Pastor Piet", contact_id: GRACE },
      { id: PASTOR_OUTSIDE, display_name: "Outside Pastor", contact_id: OUTSIDE },
      { id: ORG_ADMIN, display_name: "Org Admin", contact_id: null },
    ],
    contacts: [
      { id: ADA, first_name: "Ada", last_name: "Leader" },
      { id: GRACE, first_name: "Grace", last_name: "Pastor" },
      { id: OUTSIDE, first_name: "Olivia", last_name: "Outside", phone: "+27990000000", email: "olivia@ffsa.test" },
      { id: VEE, first_name: "Vee", last_name: "Visitor", phone: "+27111111111", email: "vee@directory.test" },
      { id: MEMBER, first_name: "Mia", last_name: "Member" },
      { id: ENDED, first_name: "Ned", last_name: "Ended" },
    ],
    org_people: [
      { id: "org-ada", org_id: MISSIO, contact_id: ADA, campus: "potch", status: "active" },
      { id: "org-grace", org_id: MISSIO, contact_id: GRACE, campus: "potch", status: "active" },
      { id: "org-vee", org_id: MISSIO, contact_id: VEE, campus: "potch", status: "visitor" },
      { id: "org-member", org_id: MISSIO, contact_id: MEMBER, campus: "potch", status: "active" },
      { id: "org-ended", org_id: MISSIO, contact_id: ENDED, campus: "potch", status: "active" },
    ],
    house_churches: [{ id: HOUSE, org_id: MISSIO, number: 1 }],
    house_church_members: [
      { id: "m-ada", house_church_id: HOUSE, contact_id: ADA, role: "leader", started_at: "2026-01-01", ended_at: null },
      { id: "m-member", house_church_id: HOUSE, contact_id: MEMBER, role: "member", started_at: "2026-01-01", ended_at: null },
      { id: "m-ended", house_church_id: HOUSE, contact_id: ENDED, role: "co_leader", started_at: "2025-01-01", ended_at: "2026-01-01" },
    ],
    connect_responses: [
      {
        id: CARD,
        org_id: MISSIO,
        name: "New Card",
        phone: "+27444444444",
        email: "typed@card.test",
        visit_type: "first_time",
        wants_house_church: true,
        wants_prayer: true,
        submitted_at: "2026-11-01T10:00:00.000Z",
        matched_contact_id: null,
        campus: "potch",
        source: "qr",
      },
      {
        id: CARD_VEE,
        org_id: MISSIO,
        name: "Vee Visitor",
        phone: "+27222222222",
        email: "typed-vee@card.test",
        visit_type: "been_a_while",
        wants_house_church: false,
        wants_prayer: false,
        submitted_at: "2026-11-02T10:00:00.000Z",
        matched_contact_id: VEE,
        campus: "potch",
        source: "qr",
      },
      {
        id: CARD_OUT,
        org_id: MISSIO,
        name: "Olivia Outside",
        phone: "+27821234567",
        email: "olivia@ffsa.test",
        visit_type: "regular",
        wants_house_church: true,
        wants_prayer: false,
        submitted_at: "2026-10-01T10:00:00.000Z",
        matched_contact_id: OUTSIDE,
        campus: "potch",
        source: "qr",
      },
    ],
    contact_phones: [{ contact_id: OUTSIDE, phone_normalized: "+27821234567" }],
    contact_emails: [{ contact_id: OUTSIDE, email_normalized: "olivia@ffsa.test" }],
    missio_not_in_house: [
      {
        source: "contact",
        contact_id: VEE,
        connect_response_id: CARD_VEE,
        display_name: "Vee Visitor",
        phone: "+27111111111",
        email: "vee@directory.test",
        wants_house_church: false,
        followup_stage: "contacted",
        submitted_at: "2026-11-02T10:00:00.000Z",
      },
      {
        source: "connect_response",
        contact_id: null,
        connect_response_id: CARD,
        display_name: "New Card",
        phone: "+27333333333",
        email: "coalesced@contact.test",
        wants_house_church: true,
        followup_stage: null,
        submitted_at: "2026-11-01T10:00:00.000Z",
      },
      {
        source: "connect_response",
        contact_id: OUTSIDE,
        connect_response_id: CARD_OUT,
        display_name: "Olivia Outside",
        phone: "+27990000000",
        email: "olivia@ffsa.test",
        wants_house_church: true,
        followup_stage: null,
        submitted_at: "2026-10-01T10:00:00.000Z",
      },
    ],
    missio_followups: [
      {
        id: FOLLOW,
        org_id: MISSIO,
        contact_id: VEE,
        connect_response_id: CARD_VEE,
        stage: "contacted",
        assigned_leader_contact_id: ADA,
        created_at: "2026-11-02T11:00:00.000Z",
        updated_at: "2026-11-02T11:00:00.000Z",
      },
    ],
    missio_followup_stage_history: [
      {
        id: "hist-stage",
        followup_id: FOLLOW,
        from_stage: "new",
        to_stage: "contacted",
        changed_by: PASTOR,
        changed_at: "2026-11-02T12:00:00.000Z",
        notes: null,
        kind: "stage_change",
      },
      {
        id: "hist-note",
        followup_id: FOLLOW,
        from_stage: null,
        to_stage: null,
        changed_by: PASTOR,
        changed_at: "2026-11-03T12:00:00.000Z",
        notes: "Called her",
        kind: "note",
      },
    ],
    audit_logs: [],
  };
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
}

function ctx(key: string) {
  return { params: Promise.resolve({ key }) };
}

describe("missio follow-up", () => {
  beforeEach(reset);

  it("refuses signed-out callers and anyone who is not a Missio pastor", async () => {
    state.userId = null;
    expect((await listPeople(new Request("https://hub.test/api/missio/follow-up"))).status).toBe(401);

    state.userId = ORG_ADMIN;
    expect((await listPeople(new Request("https://hub.test/api/missio/follow-up"))).status).toBe(403);

    state.userId = FFSA_ADMIN;
    const res = await listPeople(new Request("https://hub.test/api/missio/follow-up"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Not authorized", code: "forbidden" });
  });

  it("lists people with effective stage, and hides directory phone and email on contact rows", async () => {
    expect(FOLLOWUP_LIST_INCLUDES_CONTACT_PII).toBe(false);
    const res = await listPeople(new Request("https://hub.test/api/missio/follow-up"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.canWrite).toBe(true);
    const vee = body.people.find((person: { key: string }) => person.key === `c_${VEE}`);
    const card = body.people.find((person: { key: string }) => person.key === `r_${CARD}`);
    expect(vee).toMatchObject({
      source: "contact",
      contactId: VEE,
      connectResponseId: CARD_VEE,
      followupId: FOLLOW,
      phone: null,
      email: null,
      visitType: "been_a_while",
      stage: "contacted",
      assignedLeader: { contactId: ADA, displayName: "Ada Leader" },
    });
    expect(JSON.stringify(vee)).not.toContain("+27111111111");
    expect(JSON.stringify(vee)).not.toContain("vee@directory.test");
    expect(JSON.stringify(vee)).not.toContain("+27222222222");
    expect(card).toMatchObject({
      source: "connect_response",
      contactId: null,
      phone: "+27444444444",
      email: "typed@card.test",
      visitType: "first_time",
      wantsPrayer: true,
      stage: "new",
      assignedLeader: null,
      followupId: null,
    });
    expect(card.phone).not.toBe("+27333333333");

    const contacted = await listPeople(new Request("https://hub.test/api/missio/follow-up?stage=contacted"));
    expect((await contacted.json()).people.map((person: { key: string }) => person.key)).toEqual([`c_${VEE}`]);
    const unassigned = await listPeople(new Request("https://hub.test/api/missio/follow-up?leader=unassigned"));
    const keys = (await unassigned.json()).people.map((person: { key: string }) => person.key);
    expect(keys).toContain(`r_${CARD}`);
    expect(keys).not.toContain(`c_${VEE}`);
    const byAda = await listPeople(new Request(`https://hub.test/api/missio/follow-up?leader=${ADA}`));
    expect((await byAda.json()).people.map((person: { key: string }) => person.key)).toEqual([`c_${VEE}`]);
  });

  it("lists only current house leaders and Missio pastors who already have a person row", async () => {
    const res = await listLeaders();
    expect(res.status).toBe(200);
    const ids = (await res.json()).leaders.map((leader: { contactId: string }) => leader.contactId);
    expect(ids).toEqual(expect.arrayContaining([ADA, GRACE]));
    expect(ids).toContain(ADA);
    expect(ids).toContain(GRACE);
    expect(ids).not.toContain(OUTSIDE);
    expect(ids).not.toContain(MEMBER);
    expect(ids).not.toContain(ENDED);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("upserts a stage on the session client and never writes a stage_change row", async () => {
    const created = await patchStage(
      new Request("https://hub.test/api/missio/follow-up", {
        method: "PATCH",
        body: JSON.stringify({ stage: "contacted" }),
      }),
      ctx(`r_${CARD}`)
    );
    expect(created.status).toBe(200);
    const createdBody = await created.json();
    expect(createdBody.person.stage).toBe("contacted");
    expect(createdBody.person.followupId).toEqual(expect.any(String));
    const insert = state.writes.find((write) => write.table === "missio_followups" && write.op === "insert");
    expect(insert).toMatchObject({ client: "user", payload: { stage: "contacted", connect_response_id: CARD } });
    expect(state.writes.filter((write) => write.table === "missio_followup_stage_history")).toHaveLength(0);

    state.writes = [];
    const moved = await patchStage(
      new Request("https://hub.test/api/missio/follow-up", {
        method: "PATCH",
        body: JSON.stringify({ stage: "visited_house", note: "She visited" }),
      }),
      ctx(`c_${VEE}`)
    );
    expect(moved.status).toBe(200);
    const movedBody = await moved.json();
    expect(movedBody.person.stage).toBe("visited_house");
    expect(movedBody.entries).toEqual([
      expect.objectContaining({ kind: "note", body: "She visited", by: { displayName: "Pastor Piet" } }),
    ]);
    const update = state.writes.find((write) => write.table === "missio_followups" && write.op === "update");
    expect(update).toMatchObject({ client: "user", payload: { stage: "visited_house" } });
    expect(update?.filters).toEqual(
      expect.arrayContaining([
        { type: "eq", col: "stage", val: "contacted" },
        { type: "eq", col: "updated_at", val: "2026-11-02T11:00:00.000Z" },
      ])
    );
    const notes = state.writes.filter((write) => write.table === "missio_followup_stage_history");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ client: "user", payload: { kind: "note", notes: "She visited", followup_id: FOLLOW } });
    expect(notes[0].payload).not.toHaveProperty("changed_by");
    expect(JSON.stringify(notes)).not.toContain("stage_change");
  });

  it("rejects a leader who is not on the leaders list and accepts one who is", async () => {
    state.reads = [];
    const missingId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9";
    const missing = await patchLeader(
      new Request("https://hub.test/api/missio/follow-up", {
        method: "PATCH",
        body: JSON.stringify({ leaderContactId: missingId }),
      }),
      ctx(`r_${CARD}`)
    );
    const missingBody = await missing.json();
    state.reads = [];
    const bad = await patchLeader(
      new Request("https://hub.test/api/missio/follow-up", {
        method: "PATCH",
        body: JSON.stringify({ leaderContactId: OUTSIDE }),
      }),
      ctx(`r_${CARD}`)
    );
    expect(bad.status).toBe(400);
    expect(missing.status).toBe(400);
    expect(missingBody).toEqual({ error: "This person is not in Missio.", code: "not_missio_person" });
    expect(await bad.json()).toEqual(missingBody);
    expect(state.reads.filter((read) => read.client === "admin" || read.table === "contacts")).toEqual([]);
    expect(JSON.stringify(missingBody)).not.toContain("Olivia");
    expect(state.writes.filter((write) => write.table === "missio_followups")).toHaveLength(0);

    const member = await patchLeader(
      new Request("https://hub.test/api/missio/follow-up", {
        method: "PATCH",
        body: JSON.stringify({ leaderContactId: MEMBER }),
      }),
      ctx(`c_${VEE}`)
    );
    expect(member.status).toBe(400);

    const ok = await patchLeader(
      new Request("https://hub.test/api/missio/follow-up", {
        method: "PATCH",
        body: JSON.stringify({ leaderContactId: ADA }),
      }),
      ctx(`c_${VEE}`)
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).person.assignedLeader.contactId).toBe(ADA);
    const cleared = await patchLeader(
      new Request("https://hub.test/api/missio/follow-up", {
        method: "PATCH",
        body: JSON.stringify({ leaderContactId: null }),
      }),
      ctx(`c_${VEE}`)
    );
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).person.assignedLeader).toBeNull();
  });

  it("synthesises the card submission and returns notes newest first", async () => {
    const res = await getTimeline(new Request("https://hub.test/api/missio/follow-up"), ctx(`c_${VEE}`));
    expect(res.status).toBe(200);
    const { entries } = await res.json();
    expect(entries.map((entry: { kind: string }) => entry.kind)).toEqual(["note", "stage_change", "submitted"]);
    expect(entries[0]).toMatchObject({ kind: "note", body: "Called her", by: { displayName: "Pastor Piet" } });
    expect(entries[1]).toMatchObject({ kind: "stage_change", fromStage: "new", toStage: "contacted" });
    expect(entries[2]).toMatchObject({
      id: `submitted_${CARD_VEE}`,
      kind: "submitted",
      fromStage: null,
      toStage: null,
      body: null,
      by: null,
      at: "2026-11-02T10:00:00.000Z",
    });

    const posted = await postTimeline(
      new Request("https://hub.test/api/missio/follow-up", {
        method: "POST",
        body: JSON.stringify({ body: "Left a message" }),
      }),
      ctx(`r_${CARD}`)
    );
    expect(posted.status).toBe(201);
    expect(await posted.json()).toEqual({
      entry: expect.objectContaining({ kind: "note", body: "Left a message", by: { displayName: "Pastor Piet" } }),
    });
    const note = state.writes.find((write) => write.table === "missio_followup_stage_history");
    expect(note).toMatchObject({ client: "user", payload: { kind: "note", notes: "Left a message" } });
    expect(note?.payload).not.toHaveProperty("changed_by");
  });

  it("creates a Missio person from a card, links an existing one, and refuses a non-Missio contact", async () => {
    const created = await postContact(
      new Request("https://hub.test/api/missio/follow-up", { method: "POST", body: "" }),
      ctx(`r_${CARD}`)
    );
    expect(created.status).toBe(200);
    const createdBody = await created.json();
    expect(createdBody.person.contactId).toEqual(expect.any(String));
    expect(createdBody.person.phone).toBeNull();
    expect(createdBody.person.email).toBeNull();
    expect(createdBody.person.key).toBe(`c_${createdBody.person.contactId}`);
    expect(state.writes.some((write) => write.table === "contacts" && write.op === "insert")).toBe(true);
    const orgAt = state.writes.findIndex((write) => write.table === "org_people" && write.op === "insert");
    const linkAt = state.writes.findIndex(
      (write) =>
        write.table === "connect_responses" &&
        write.op === "update" &&
        (write.payload as { matched_contact_id?: string }).matched_contact_id
    );
    expect(orgAt).toBeGreaterThan(-1);
    expect(linkAt).toBeGreaterThan(orgAt);
    expect(state.writes.some((write) => write.table === "org_people" && write.op === "insert")).toBe(true);
    const card = state.tables.connect_responses.find((row) => row.id === CARD);
    expect(card).toMatchObject({
      matched_contact_id: createdBody.person.contactId,
      matched_by: PASTOR,
    });

    state.writes = [];
    state.tables.missio_not_in_house.push({
      source: "connect_response",
      contact_id: GRACE,
      connect_response_id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd4",
      display_name: "Grace Pastor",
      phone: "+27000000000",
      email: "grace@directory.test",
      wants_house_church: true,
      followup_stage: null,
      submitted_at: "2026-09-01T10:00:00.000Z",
    });
    state.tables.connect_responses.push({
      id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd4",
      org_id: MISSIO,
      name: "Grace Pastor",
      phone: "+27829876543",
      email: "grace@card.test",
      visit_type: "regular",
      wants_house_church: true,
      wants_prayer: false,
      submitted_at: "2026-09-01T10:00:00.000Z",
      matched_contact_id: GRACE,
      campus: "potch",
    });
    const linked = await postContact(
      new Request("https://hub.test/api/missio/follow-up", { method: "POST", body: "{}" }),
      ctx("r_dddddddd-dddd-4ddd-8ddd-ddddddddddd4")
    );
    expect(linked.status).toBe(200);
    expect((await linked.json()).person.contactId).toBe(GRACE);
    expect(state.writes.some((write) => write.table === "contacts" && write.op === "insert")).toBe(false);
    expect(state.writes.some((write) => write.table === "org_people" && write.op === "insert")).toBe(false);

    state.writes = [];
    state.reads = [];
    const refused = await postContact(
      new Request("https://hub.test/api/missio/follow-up", { method: "POST", body: "" }),
      ctx(`r_${CARD_OUT}`)
    );
    expect(refused.status).toBe(409);
    const refusedBody = await refused.json();
    expect(refusedBody).toEqual({
      error: "This person already exists. Search by their email or phone to add them.",
      code: "exists_use_search",
    });
    expect(JSON.stringify(refusedBody)).not.toContain(OUTSIDE);
    expect(JSON.stringify(refusedBody)).not.toContain("Olivia");
    expect(state.writes.some((write) => write.table === "org_people")).toBe(false);
    expect(state.writes.some((write) => write.table === "contacts")).toBe(false);
    expect(state.reads.filter((read) => read.client === "admin" || read.table === "contacts")).toEqual([]);

    const picked = await postContact(
      new Request("https://hub.test/api/missio/follow-up", {
        method: "POST",
        body: JSON.stringify({ contactId: OUTSIDE }),
      }),
      ctx(`r_${CARD}`)
    );
    expect(picked.status).toBe(400);
    expect(state.tables.connect_responses.find((row) => row.id === CARD)?.matched_contact_id).not.toBe(OUTSIDE);
  });

  it("returns exists_use_search when the card phone belongs to someone outside Missio", async () => {
    state.tables.connect_responses.push({
      id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd5",
      org_id: MISSIO,
      name: "Same Phone",
      phone: "+27821234567",
      email: null,
      visit_type: "first_time",
      wants_house_church: false,
      wants_prayer: false,
      submitted_at: "2026-08-01T10:00:00.000Z",
      matched_contact_id: null,
      campus: "potch",
    });
    state.tables.missio_not_in_house.push({
      source: "connect_response",
      contact_id: null,
      connect_response_id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd5",
      display_name: "Same Phone",
      phone: "+27821234567",
      email: null,
      wants_house_church: false,
      followup_stage: null,
      submitted_at: "2026-08-01T10:00:00.000Z",
    });
    const res = await postContact(
      new Request("https://hub.test/api/missio/follow-up", { method: "POST", body: "" }),
      ctx("r_dddddddd-dddd-4ddd-8ddd-ddddddddddd5")
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "This person already exists. Search by their email or phone to add them.",
      code: "exists_use_search",
    });
    expect(state.writes.some((write) => write.table === "org_people" && write.op === "insert")).toBe(false);
    expect(state.tables.connect_responses.find((row) => row.id === "dddddddd-dddd-4ddd-8ddd-ddddddddddd5")?.matched_contact_id).toBeNull();
    expect(state.tables.connect_responses.find((row) => row.id === "dddddddd-dddd-4ddd-8ddd-ddddddddddd5")?.matched_by ?? null).toBeNull();
    expect(state.writes.some((write) => write.table === "org_people" && write.op === "insert")).toBe(false);
  });

  it("returns 409 when another pastor already claimed the card or the follow-up", async () => {
    state.tables.connect_responses.find((row) => row.id === CARD)!.matched_by = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9";
    const claimed = await postContact(
      new Request("https://hub.test/api/missio/follow-up", { method: "POST", body: "" }),
      ctx(`r_${CARD}`)
    );
    expect(claimed.status).toBe(409);
    expect((await claimed.json()).code).toBe("conflict");
    expect(state.writes.some((write) => write.table === "contacts" || write.table === "org_people")).toBe(false);

    state.conflictTable = "missio_followups";
    const raced = await patchStage(
      new Request("https://hub.test", { method: "PATCH", body: JSON.stringify({ stage: "joined", note: "too late" }) }),
      ctx(`c_${VEE}`)
    );
    expect(raced.status).toBe(409);
    expect((await raced.json()).code).toBe("conflict");
    expect(state.writes.some((write) => write.table === "missio_followup_stage_history")).toBe(false);
    expect(state.tables.missio_followups.find((row) => row.id === FOLLOW)?.stage).toBe("contacted");

    state.duplicateFollowup = true;
    const dup = await patchStage(
      new Request("https://hub.test", { method: "PATCH", body: JSON.stringify({ stage: "contacted" }) }),
      ctx(`r_${CARD}`)
    );
    expect(dup.status).toBe(409);
    expect((await dup.json()).code).toBe("conflict");
    expect(state.tables.missio_followups.filter((row) => row.connect_response_id === CARD && row.id !== FOLLOW)).toHaveLength(0);
  });

  it("rejects a bad key, an unknown person, and a database error without leaking it", async () => {
    expect((await patchStage(new Request("https://hub.test", { method: "PATCH", body: "{}" }), ctx("nope"))).status).toBe(400);
    expect(
      (
        await postContact(new Request("https://hub.test", { method: "POST", body: "" }), ctx(`c_${VEE}`))
      ).status
    ).toBe(400);
    const missing = await getTimeline(
      new Request("https://hub.test"),
      ctx("r_ffffffff-ffff-4fff-8fff-ffffffffffff")
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Person not found.", code: "not_found" });

    state.tableError = "missio_followups";
    const broken = await patchStage(
      new Request("https://hub.test", { method: "PATCH", body: JSON.stringify({ stage: "joined" }) }),
      ctx(`c_${VEE}`)
    );
    expect(broken.status).toBe(500);
    const body = await broken.json();
    expect(body).toEqual({ error: "Something went wrong.", code: "server_error" });
    expect(JSON.stringify(body)).not.toContain("boom");
  });

  it("rate limits follow-up writes", async () => {
    state.hits.set(`missio:follow-up-write:${PASTOR}`, 20);
    const res = await postTimeline(
      new Request("https://hub.test", { method: "POST", body: JSON.stringify({ body: "Again" }) }),
      ctx(`c_${VEE}`)
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect((await res.json()).code).toBe("rate_limited");
  });
});
