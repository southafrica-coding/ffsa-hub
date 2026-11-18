import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectRateKeyHash } from "@/lib/missio/match-token";

type Row = Record<string, unknown>;
type Filter =
  | { type: "eq"; col: string; val: unknown }
  | { type: "in"; col: string; vals: unknown[] }
  | { type: "is"; col: string; val: unknown }
  | { type: "gte"; col: string; val: unknown };

type Op = {
  action: "select" | "insert" | "update" | "delete";
  select?: string;
  payload?: Row | Row[];
  filters: Filter[];
  limit?: number;
};

const MISSIO = "11111111-1111-4111-8111-111111111111";
const JANE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const JOE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const ANN = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";

const state = vi.hoisted(() => {
  const state = {
    tableError: null as string | null,
    dbCode: null as string | null,
    dbMessage: null as string | null,
    dbDetails: null as string | null,
    dbHint: null as string | null,
    writes: [] as { table: string; op: string; payload: unknown }[],
    tables: {} as Record<string, Row[]>,
    hits: new Map<string, number>(),
    seq: 0,
    uniqueFailures: 0,
    adminClient() {
      return makeClient();
    },
  };

  function makeClient() {
    return {
      from(table: string) {
        const op: Op = { action: "select", filters: [] };
        const b = {
          select(cols?: string) {
            if (op.action === "select") op.select = cols;
            return b;
          },
          insert(payload: Row | Row[]) {
            op.action = "insert";
            op.payload = payload;
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
          gte(col: string, val: unknown) {
            op.filters.push({ type: "gte", col, val });
            return b;
          },
          limit(n: number) {
            op.limit = n;
            return b;
          },
          maybeSingle: () => Promise.resolve(finish(true)),
          then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
            return Promise.resolve(finish(false)).then(resolve, reject);
          },
        };
        return b;

        function finish(maybe: boolean) {
          if (!state.tables[table]) state.tables[table] = [];
          if (state.tableError === table) {
            return {
              data: null,
              error: {
                code: state.dbCode ?? "XX000",
                message: state.dbMessage ?? `boom reading ${table}`,
                details: state.dbDetails ?? undefined,
                hint: state.dbHint ?? undefined,
              },
            };
          }
          if (op.action === "insert") {
            if (table === "connect_responses" && state.uniqueFailures > 0) {
              state.uniqueFailures -= 1;
              state.writes.push({ client: "admin", table, op: "insert", payload: op.payload });
              return {
                data: null,
                error: {
                  code: "23505",
                  message: "duplicate key value violates unique constraint secret_table",
                  details: "Key (phone_e164) already exists",
                  hint: "Ada Lovelace",
                },
              };
            }
            const payloads = Array.isArray(op.payload) ? op.payload : [op.payload ?? {}];
            const inserted = payloads.map((payload) => {
              const row: Row = { id: payload.id ?? `${table}-${++state.seq}`, submitted_at: new Date().toISOString(), ...payload };
              if (table === "connect_responses" && row.phone_e164 == null && typeof row.phone === "string") {
                const digits = row.phone.replace(/\D/g, "");
                if (digits.startsWith("0") && digits.length === 10) row.phone_e164 = `+27${digits.slice(1)}`;
                else if (row.phone.startsWith("+")) row.phone_e164 = row.phone;
              }
              state.tables[table].push(row);
              return row;
            });
            state.writes.push({ table, op: "insert", payload: payloads });
            return { data: inserted[0] ?? null, error: null };
          }
          let rows = state.tables[table].filter((row) =>
            op.filters.every((filter) => {
              if (filter.type === "eq") return row[filter.col] === filter.val;
              if (filter.type === "in") return (filter.vals ?? []).includes(row[filter.col]);
              if (filter.type === "is") return filter.val === null ? row[filter.col] == null : row[filter.col] === filter.val;
              if (filter.type === "gte") return row[filter.col] != null && String(row[filter.col]) >= String(filter.val);
              return true;
            })
          );
          if (op.limit != null) rows = rows.slice(0, op.limit);
          if (maybe) return { data: rows[0] ?? null, error: rows.length > 1 ? { message: "multiple rows" } : null };
          return { data: rows, error: null };
        }
      },
    };
  }

  return state;
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    throw new Error("public connect must not open a user client");
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => state.adminClient(),
}));
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

const { POST } = await import("./route");
const { CONNECT_GLOBAL_LIMIT } = await import("@/lib/missio/connect");

function reset() {
  state.tableError = null;
  state.dbCode = null;
  state.dbMessage = null;
  state.dbDetails = null;
  state.dbHint = null;
  state.writes = [];
  state.hits = new Map();
  state.seq = 0;
  state.uniqueFailures = 0;
  state.tables = {
    organisations: [{ id: MISSIO, slug: "missio" }],
    contacts: [],
    contact_phones: [],
    contact_emails: [],
    connect_responses: [],
    org_people: [],
  };
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
}

function card(body: Record<string, unknown>, ip = "203.0.113.8") {
  return new Request("https://hub.test/api/missio/connect", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

const valid = {
  name: "Jane Doe",
  phone: "0821234567",
  email: "Jane@Example.com",
  visitType: "first_time",
  wantsHouseChurch: true,
  wantsPrayer: true,
  prayerRequest: "Please pray",
  notes: "Came with a friend",
};

describe("POST /api/missio/connect", () => {
  beforeEach(reset);

  it("returns only { ok: true } and stores a qr card without creating a person", async () => {
    state.tables.contacts.push({ id: JANE, first_name: "Other", last_name: "Person" });
    state.tables.contact_phones.push({ contact_id: JANE, phone_normalized: "+27821234567" });
    state.tables.org_people.push({ id: "org-jane", org_id: MISSIO, contact_id: JANE });

    const res = await POST(card(valid));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(Object.keys(body)).toEqual(["ok"]);
    expect(JSON.stringify(body)).not.toContain(JANE);
    expect(JSON.stringify(body)).not.toContain("+27821234567");

    const rows = state.tables.connect_responses;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      org_id: MISSIO,
      name: "Jane Doe",
      phone: "0821234567",
      email: "Jane@Example.com",
      visit_type: "first_time",
      wants_house_church: true,
      wants_prayer: true,
      prayer_request: "Please pray",
      notes: "Came with a friend",
      campus: "potch",
      source: "qr",
      matched_contact_id: JANE,
      matched_by: null,
    });
    expect(rows[0].matched_at).toBeUndefined();
    expect(rows[0].rate_key_hash).toBe(connectRateKeyHash("203.0.113.8"));
    expect(rows[0].rate_key_hash).not.toBe("203.0.113.8");
    const inserted = (state.writes.find((write) => write.table === "connect_responses")?.payload as Row[])[0];
    expect(inserted.phone).toBe("0821234567");
    expect(inserted).not.toHaveProperty("phone_e164");
    expect(inserted).not.toHaveProperty("matched_at");
    expect(inserted.matched_by).toBeNull();
    expect(state.writes.filter((write) => write.table === "org_people")).toHaveLength(0);
    expect(state.tables.org_people).toHaveLength(1);
  });

  it("drops a filled honeypot without inserting", async () => {
    const res = await POST(card({ ...valid, website: "https://spam.example" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(state.tables.connect_responses).toHaveLength(0);
    expect(state.hits.size).toBe(0);
  });

  it("does not insert a second card for the same phone within 10 minutes", async () => {
    const first = await POST(card(valid, "203.0.113.9"));
    const second = await POST(card({ ...valid, name: "Jane Doe Again" }, "203.0.113.10"));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual({ ok: true });
    expect(state.tables.connect_responses).toHaveLength(1);
    expect(state.tables.connect_responses[0].name).toBe("Jane Doe");
  });

  it("rate limits an IP and a global flood", async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await POST(card({ ...valid, phone: `082123456${i}` }, "198.51.100.4"));
      expect(res.status).toBe(201);
    }
    const blocked = await POST(card({ ...valid, phone: "0821234506" }, "198.51.100.4"));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({
      error: "Too many attempts. Try again shortly.",
      code: "rate_limited",
    });
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(state.tables.connect_responses).toHaveLength(5);

    reset();
    state.hits.set("missio:connect:global", CONNECT_GLOBAL_LIMIT);
    const flooded = await POST(card(valid, "198.51.100.5"));
    expect(flooded.status).toBe(429);
    expect((await flooded.json()).code).toBe("rate_limited");
    expect(state.tables.connect_responses).toHaveLength(0);
  });

  it("returns field errors and no row for invalid input", async () => {
    const res = await POST(
      card({
        name: "J",
        phone: "nope",
        email: "not-an-email",
        visitType: "sometimes",
        wantsHouseChurch: true,
        prayerRequest: "x".repeat(1001),
        notes: "y".repeat(1001),
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Check the fields and try again.",
      code: "invalid_input",
      fieldErrors: {
        name: "Check this field and try again.",
        phone: "Check this field and try again.",
        email: "Check this field and try again.",
        visitType: "Check this field and try again.",
        prayerRequest: "Check this field and try again.",
        notes: "Check this field and try again.",
      },
    });
    expect(state.tables.connect_responses).toHaveLength(0);
  });

  it("rejects an oversized body", async () => {
    const res = await POST(
      new Request("https://hub.test/api/missio/connect", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "20000" },
        body: JSON.stringify(valid),
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_input");
    expect(state.tables.connect_responses).toHaveLength(0);
  });

  it("matches phone, then email, then a unique exact name, and still saves when matching fails", async () => {
    state.tables.contacts.push(
      { id: JANE, first_name: "Jane", last_name: "Doe" },
      { id: JOE, first_name: "Joe", last_name: "Bloggs" },
      { id: ANN, first_name: "Ann", last_name: "Other" }
    );
    state.tables.contact_phones.push({ contact_id: JANE, phone_normalized: "+27821234567" });
    state.tables.contact_emails.push({ contact_id: JOE, email_normalized: "jane@example.com" });
    state.tables.org_people.push(
      { id: "org-jane", org_id: MISSIO, contact_id: JANE },
      { id: "org-joe", org_id: MISSIO, contact_id: JOE },
      { id: "org-ann", org_id: MISSIO, contact_id: ANN }
    );

    const byPhone = await POST(card({ ...valid, name: "Ann Other" }, "203.0.113.20"));
    expect(byPhone.status).toBe(201);
    expect(state.tables.connect_responses[0].matched_contact_id).toBe(JANE);

    state.tables.connect_responses = [];
    const byEmail = await POST(
      card({ ...valid, phone: "0831234567", name: "Ann Other" }, "203.0.113.21")
    );
    expect(byEmail.status).toBe(201);
    expect(state.tables.connect_responses.at(-1)?.matched_contact_id).toBe(JOE);

    state.tables.connect_responses = [];
    const byName = await POST(
      card({ ...valid, phone: "0841234567", email: undefined, name: "Ann Other" }, "203.0.113.22")
    );
    expect(byName.status).toBe(201);
    expect(state.tables.connect_responses.at(-1)?.matched_contact_id).toBe(ANN);

    state.tables.contacts.push({ id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc4", first_name: "Ann", last_name: "Other" });
    state.tables.connect_responses = [];
    const ambiguous = await POST(
      card({ ...valid, phone: "0851234567", email: undefined, name: "Ann Other" }, "203.0.113.23")
    );
    expect(ambiguous.status).toBe(201);
    expect(state.tables.connect_responses.at(-1)?.matched_contact_id).toBeNull();

    state.tableError = "contact_phones";
    state.tables.connect_responses = [];
    const broken = await POST(card({ ...valid, phone: "0861234567" }, "203.0.113.24"));
    expect(broken.status).toBe(201);
    expect(await broken.json()).toEqual({ ok: true });
    expect(state.tables.connect_responses.at(-1)?.matched_contact_id).toBeNull();
    expect(state.writes.filter((write) => write.table === "org_people")).toHaveLength(0);
  });

  it("does not match an FFSA contact who is not in Missio, and does not create org_people", async () => {
    state.tables.contacts.push(
      { id: JANE, first_name: "Jane", last_name: "Doe" },
      { id: ANN, first_name: "Ann", last_name: "Other" }
    );
    state.tables.contact_phones.push({ contact_id: JANE, phone_normalized: "+27821234567" });
    state.tables.org_people.push({ id: "org-ann", org_id: MISSIO, contact_id: ANN });

    const res = await POST(card({ ...valid, name: "Ann Other" }, "203.0.113.40"));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(state.tables.connect_responses[0].matched_contact_id).toBeNull();
    expect(state.writes.filter((write) => write.table === "org_people")).toHaveLength(0);
    expect(state.tables.org_people.map((row) => row.contact_id)).toEqual([ANN]);
  });

  it("does not put database text or the submitted value into an error body", async () => {
    const secret = "23503 missio_contact_not_in_org secret_table Ada Lovelace";
    const invalid = await POST(
      card({
        ...valid,
        name: "J",
        visitType: secret,
        notes: secret,
        prayerRequest: secret,
      })
    );
    expect(invalid.status).toBe(400);
    const invalidBody = JSON.stringify(await invalid.json());
    expect(invalidBody).not.toContain(secret);
    expect(invalidBody).not.toContain("missio_contact_not_in_org");
    expect(invalidBody).not.toContain("Ada Lovelace");
    expect(invalidBody).toContain("invalid_input");

    state.tableError = "connect_responses";
    state.dbCode = "23514";
    state.dbMessage = "missio_ended_at_in_future";
    state.dbDetails = secret;
    state.dbHint = "ended_at > current_date";
    const ended = await POST(card({ ...valid, phone: "0830000000" }, "203.0.113.50"));
    expect(ended.status).toBe(409);
    const endedBody = JSON.stringify(await ended.json());
    expect(endedBody).toContain("ended_at_in_future");
    expect(endedBody).not.toContain("missio_ended_at_in_future");
    expect(endedBody).not.toContain(secret);
    expect(endedBody).not.toContain("current_date");

    state.tableError = "connect_responses";
    state.dbCode = "XX000";
    state.dbMessage = secret;
    state.dbDetails = "Key (contact_id)=(secret) already exists";
    state.dbHint = secret;
    const other = await POST(card({ ...valid, phone: "0840000000" }, "203.0.113.51"));
    expect(other.status).toBe(500);
    const otherBody = JSON.stringify(await other.json());
    expect(otherBody).toContain("server_error");
    expect(otherBody).not.toContain(secret);
    expect(otherBody).not.toContain("contact_id");
    expect(otherBody).not.toContain("XX000");
  });

  it("retries a matched insert once, then stores the card unmatched", async () => {
    state.tables.contacts.push({ id: JANE, first_name: "Jane", last_name: "Doe" });
    state.tables.contact_phones.push({ contact_id: JANE, phone_normalized: "+27821234567" });
    state.tables.org_people.push({ id: "org-jane", org_id: MISSIO, contact_id: JANE });

    state.uniqueFailures = 1;
    const retried = await POST(card(valid, "203.0.113.60"));
    expect(retried.status).toBe(201);
    const retriedBody = await retried.json();
    expect(retriedBody).toEqual({ ok: true });
    expect(JSON.stringify(retriedBody)).not.toContain("23505");
    expect(JSON.stringify(retriedBody)).not.toContain("duplicate");
    expect(state.tables.connect_responses).toHaveLength(1);
    expect(state.tables.connect_responses[0].matched_contact_id).toBe(JANE);
    expect(state.writes.filter((write) => write.table === "connect_responses" && write.op === "insert")).toHaveLength(2);

    state.tables.connect_responses = [];
    state.writes = [];
    state.uniqueFailures = 2;
    const fallback = await POST(card({ ...valid, phone: "0831234567" }, "203.0.113.61"));
    expect(fallback.status).toBe(201);
    const fallbackBody = await fallback.json();
    expect(fallbackBody).toEqual({ ok: true });
    expect(JSON.stringify(fallbackBody)).not.toContain("23505");
    expect(JSON.stringify(fallbackBody)).not.toContain("duplicate");
    expect(JSON.stringify(fallbackBody)).not.toContain("Ada Lovelace");
    expect(state.tables.connect_responses).toHaveLength(1);
    expect(state.tables.connect_responses[0].matched_contact_id).toBeNull();
    const inserts = state.writes.filter((write) => write.table === "connect_responses" && write.op === "insert");
    expect(inserts).toHaveLength(3);
    expect((inserts[2].payload as Row[])[0].matched_contact_id).toBeNull();
  });

  it("does not store the raw IP when the HMAC key is missing", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await POST(card(valid, "203.0.113.30"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Something went wrong.", code: "server_error" });
    expect(JSON.stringify(state.tables.connect_responses)).not.toContain("203.0.113.30");
    expect(state.tables.connect_responses).toHaveLength(0);
  });
});
