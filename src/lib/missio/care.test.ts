import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));
let allowed = true;
vi.mock("@/lib/rate-limit", () => ({
  getRateLimiter: () => ({ hit: async () => ({ allowed, resetAt: Date.now() + 1000 }) }),
  retryAfterSeconds: () => 60,
}));
vi.mock("@/lib/missio/match-token", () => ({ connectRateKeyHash: () => "hashed" }));

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};

function from(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let action: "select" | "insert" | "update" = "select";
  let payload: Row | null = null;
  const rows = () => (tables[table] ??= []);
  const run = (): { data?: Row[]; error?: { code: string; message: string } } => {
    if (action === "insert") {
      if (table === "missio_care_requests" && payload!.source_id && rows().some((row) => row.source === payload!.source && row.source_id === payload!.source_id)) {
        return { error: { code: "23505", message: "dup" } };
      }
      const row = {
        id: `c${rows().length + 1}`,
        status: "new",
        urgent: false,
        privacy: "pastors",
        created_at: "2026-11-19T08:00:00Z",
        taken_by: null,
        taken_at: null,
        done_at: null,
        done_note: null,
        checked_in_at: null,
        house_church_id: null,
        name: null,
        phone: null,
        body: null,
        ...payload,
      };
      rows().push(row);
      return { data: [row] };
    }
    const hit = rows().filter((row) => filters.every((f) => f(row)));
    if (action === "update") for (const row of hit) Object.assign(row, payload);
    return { data: hit };
  };
  const b = {
    select: () => b,
    insert: (value: Row) => ((action = "insert"), (payload = value), b),
    update: (value: Row) => ((action = "update"), (payload = value), b),
    eq: (col: string, val: unknown) => (filters.push((row) => row[col] === val), b),
    in: (col: string, vals: unknown[]) => (filters.push((row) => vals.includes(row[col])), b),
    gte: (col: string, val: string) => (filters.push((row) => String(row[col]) >= val), b),
    not: (col: string) => (filters.push((row) => row[col] != null), b),
    limit: () => b,
    maybeSingle: () => {
      const out = run();
      return Promise.resolve({ data: out.data?.[0] ?? null, error: out.error ?? null });
    },
    then: (resolve: (value: unknown) => unknown) => {
      const out = run();
      return Promise.resolve({ data: out.data ?? null, error: out.error ?? null }).then(resolve);
    },
  };
  return b;
}
const db = { from };
const { listCare, stepCare, submitCareForm } = await import("./care");

const auth = { supabase: db, orgId: "org", user: { id: "pastor-1" } } as never;
const now = new Date("2026-11-20T08:00:00Z");

beforeEach(() => {
  allowed = true;
  for (const key of Object.keys(tables)) delete tables[key];
  tables.organisations = [{ id: "org", slug: "missio" }];
  tables.users = [{ id: "pastor-1", first_name: "Gabriël", last_name: "V", preferred_name: null }];
  tables.house_churches = [{ id: "h13", number: 13, name: null }];
});

describe("the care form", () => {
  it("takes an anonymous prayer request", async () => {
    const sent = await submitCareForm({ needs: ["prayer"], body: "Pray for my marriage.", privacy: "pastors", consent: true }, "1.2.3.4");
    expect(sent).toEqual({ ok: true, first: null });
    expect(tables.missio_care_requests![0]).toMatchObject({ source: "care_form", name: null, phone: null, needs: ["prayer"], rate_key_hash: "hashed" });
  });

  it("needs a phone for talk, practical help or urgent, and consent always", async () => {
    const talk = await submitCareForm({ needs: ["talk"], body: "x", privacy: "pastors", consent: true, name: "Sizwe" }, "ip");
    expect(talk.ok ? null : talk.error).toBe("Add a phone number so someone can reply.");
    const urgent = await submitCareForm({ needs: ["prayer"], body: "x", privacy: "pastors", urgent: true, consent: true }, "ip");
    expect(urgent.ok).toBe(false);
    const noConsent = await submitCareForm({ needs: ["prayer"], body: "x", privacy: "pastors" }, "ip");
    expect(noConsent.ok).toBe(false);
    const fine = await submitCareForm(
      { needs: ["prayer", "practical"], body: "Meals please", privacy: "pastors_leaders", consent: true, name: "Thabo Nkosi", phone: "071 555 8890" },
      "ip"
    );
    expect(fine).toEqual({ ok: true, first: "Thabo" });
  });

  it("is rate limited and ignores the honeypot", async () => {
    const bot = await submitCareForm({ needs: ["prayer"], body: "x", privacy: "pastors", consent: true, website: "spam" }, "ip");
    expect(bot.ok).toBe(true);
    expect(tables.missio_care_requests ?? []).toHaveLength(0);
    allowed = false;
    const limited = await submitCareForm({ needs: ["prayer"], body: "x", privacy: "pastors", consent: true }, "ip");
    expect(limited.ok ? null : limited.status).toBe(429);
  });
});

describe("the care board", () => {
  it("pulls connect-card and feedback prayer in once, and lets one pastor take a request", async () => {
    tables.connect_responses = [
      { id: "card1", org_id: "org", wants_prayer: true, name: "Mia Grobler", phone: "082", prayer_request: "My exams", matched_contact_id: null, submitted_at: "2026-11-18T08:00:00Z" },
    ];
    tables.missio_house_feedback = [{ id: "fb1", house_church_id: "h13", prayer: "Baby born Saturday 🎉 Meals please.", submitted_at: "2026-11-15T08:00:00Z" }];
    const first = await listCare(auth, now);
    if (!first.ok) throw new Error(first.code);
    expect(first.me).toBe("Gabriël");
    expect(first.requests.map((request) => [request.source, request.name, request.house?.number ?? null])).toEqual([
      ["connect_card", "Mia Grobler", null],
      ["house_feedback", null, 13],
    ]);
    const again = await listCare(auth, now);
    expect(again.ok && again.requests).toHaveLength(2);

    const id = first.requests[0]!.id;
    expect((await stepCare(auth, id, { action: "take" }, now)).ok).toBe(true);
    const second = await stepCare(auth, id, { action: "take" }, now);
    expect(second.ok ? null : second.code).toBe("already_resolved");
    await stepCare(auth, id, { action: "done" }, now);
    const later = await listCare(auth, new Date("2026-12-05T08:00:00Z"));
    expect(later.ok && later.requests.find((request) => request.id === id)).toMatchObject({ status: "done", checkIn: true, takenBy: { name: "Gabriël V" } });
  });
});
