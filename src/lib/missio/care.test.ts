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

/**
 * Who is asking. The real rules are RLS (migration 354, checked against
 * Postgres in supabase/tests/missio_care_privacy_rls.sql); this stand-in
 * mirrors them so the app layer can be tested on what RLS hands it.
 */
type Viewer = { pastor: boolean; led: string[]; member: string[] };
const everyone: Viewer = { pastor: true, led: [], member: [] };

function careVisible(viewer: Viewer, row: Row): boolean {
  if (viewer.pastor) return true;
  const house = row.house_church_id as string | null;
  if (!house) return false;
  if (viewer.led.includes(house) && (row.privacy === "pastors_leaders" || row.privacy === "house")) return true;
  return viewer.member.includes(house) && row.privacy === "house";
}

function from(table: string, viewer: Viewer = everyone) {
  const filters: Array<(row: Row) => boolean> = [];
  let action: "select" | "insert" | "update" = "select";
  let payload: Row | null = null;
  const rows = () => (tables[table] ??= []);
  const run = (): { data?: Row[]; error?: { code: string; message: string } } => {
    if (table === "missio_care_requests" && action === "insert" && !viewer.pastor) return { error: { code: "42501", message: "rls" } };
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
    const visible = table === "missio_care_requests" ? rows().filter((row) => careVisible(viewer, row)) : rows();
    let hit = visible.filter((row) => filters.every((f) => f(row)));
    if (action === "update") {
      if (table === "missio_care_requests" && !viewer.pastor) hit = hit.filter((row) => viewer.led.includes(row.house_church_id as string));
      for (const row of hit) Object.assign(row, payload);
    }
    // Authenticated users cannot read the phone column (354).
    if (table === "missio_care_requests" && viewer !== everyone) {
      return { data: hit.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "phone"))) };
    }
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
const { listCare, logCare, stepCare, submitCareForm } = await import("./care");

/** A user client as `viewer`: RLS-filtered reads plus the 338 / 354 helpers. */
function clientFor(viewer: Viewer) {
  return {
    from: (table: string) => from(table, viewer),
    rpc: async (fn: string, args?: { p_ids?: string[] }) => {
      if (fn === "missio_led_house_ids") return { data: viewer.led, error: null };
      if (fn === "missio_care_phones") {
        const data = (tables.missio_care_requests ?? [])
          .filter((row) => args?.p_ids?.includes(row.id as string) && row.phone)
          .filter((row) => viewer.pastor || (viewer.led.includes(row.house_church_id as string) && row.privacy !== "pastors"))
          .map((row) => ({ id: row.id, phone: row.phone }));
        return { data, error: null };
      }
      return { data: null, error: { message: `no ${fn}` } };
    },
  };
}
const as = (id: string, roles: string[], viewer: Viewer) => ({ supabase: clientFor(viewer), orgId: "org", user: { id }, roles }) as never;

const auth = as("pastor-1", ["pastor"], { pastor: true, led: [], member: [] });
const leader = as("leader-13", ["house_church_leader"], { pastor: false, led: ["h13"], member: ["h13"] });
// A coach who belongs to house 13 as an ordinary member.
const member = as("member-13", ["coach"], { pastor: false, led: [], member: ["h13"] });
const otherLeader = as("leader-14", ["house_church_leader"], { pastor: false, led: ["h14"], member: ["h14"] });
const now = new Date("2026-11-20T08:00:00Z");

beforeEach(() => {
  allowed = true;
  for (const key of Object.keys(tables)) delete tables[key];
  tables.organisations = [{ id: "org", slug: "missio" }];
  tables.users = [
    { id: "pastor-1", first_name: "Gabriël", last_name: "V", preferred_name: null },
    { id: "leader-13", first_name: "Lerato", last_name: "M", preferred_name: null },
  ];
  tables.house_churches = [
    { id: "h13", number: 13, name: null },
    { id: "h14", number: 14, name: null },
  ];
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

describe("who sees what (privacy)", () => {
  // Phone numbers here are placeholders, not real numbers.
  const seed = () => {
    const base = { org_id: "org", source: "manual", needs: ["prayer", "talk"], status: "new", urgent: false, created_at: "2026-11-19T08:00:00Z" };
    tables.missio_care_requests = [
      { ...base, id: "p13", name: "Pastors only", phone: "000 000 0001", privacy: "pastors", house_church_id: "h13" },
      { ...base, id: "l13", name: "Leaders 13", phone: "000 000 0002", privacy: "pastors_leaders", house_church_id: "h13" },
      { ...base, id: "h13r", name: "House 13", phone: "000 000 0003", privacy: "house", house_church_id: "h13" },
      { ...base, id: "h14r", name: "House 14", phone: "000 000 0004", privacy: "house", house_church_id: "h14" },
      { ...base, id: "none", name: "No house", phone: "000 000 0005", privacy: "house", house_church_id: null },
    ];
  };
  const names = (result: Awaited<ReturnType<typeof listCare>>) => (result.ok ? result.requests.map((r) => r.name).sort() : result.code);

  it("a pastor sees every request, phones included, and may act on all of them", async () => {
    seed();
    const board = await listCare(auth, now);
    expect(names(board)).toEqual(["House 13", "House 14", "Leaders 13", "No house", "Pastors only"]);
    expect(board.ok && board.pastor).toBe(true);
    expect(board.ok && board.requests.every((r) => r.canStep && r.phone)).toBe(true);
  });

  it("a leader sees pastors_leaders and house requests for their house only, with phones, and can take them", async () => {
    seed();
    const board = await listCare(leader, now);
    expect(names(board)).toEqual(["House 13", "Leaders 13"]);
    expect(board.ok && board.pastor).toBe(false);
    expect(board.ok && board.requests.map((r) => [r.name, r.phone, r.canStep])).toEqual([
      ["Leaders 13", "000 000 0002", true],
      ["House 13", "000 000 0003", true],
    ]);
    expect((await stepCare(leader, "l13", { action: "take" }, now)).ok).toBe(true);
    expect(tables.missio_care_requests!.find((r) => r.id === "l13")).toMatchObject({ status: "on_it", taken_by: "leader-13" });
    expect((await stepCare(leader, "l13", { action: "done" }, now)).ok).toBe(true);
    expect((await stepCare(leader, "l13", { action: "checked_in" }, now)).ok).toBe(true);
  });

  it("a leader cannot reopen, cannot reach another house, and cannot log by hand", async () => {
    seed();
    await stepCare(leader, "h13r", { action: "done" }, now);
    const reopen = await stepCare(leader, "h13r", { action: "reopen" }, now);
    expect(reopen.ok ? null : reopen.status).toBe(403);
    const other = await stepCare(leader, "h14r", { action: "take" }, now);
    expect(other.ok ? null : other.status).toBe(404);
    const hidden = await stepCare(leader, "p13", { action: "take" }, now);
    expect(hidden.ok ? null : hidden.status).toBe(404);
    const logged = await logCare(leader, { needs: ["prayer"], body: "x", privacy: "house" });
    expect(logged.ok ? null : logged.status).toBe(403);
    expect(tables.missio_care_requests).toHaveLength(5);
  });

  it("a member sees only house requests for their house, without a phone, and cannot step them", async () => {
    seed();
    const board = await listCare(member, now);
    expect(board.ok && board.requests.map((r) => [r.name, r.phone, r.canStep])).toEqual([["House 13", null, false]]);
    for (const action of ["take", "done", "checked_in", "reopen"] as const) {
      const step = await stepCare(member, "h13r", { action }, now);
      expect(step.ok ? null : step.status).toBe(403);
    }
    expect(tables.missio_care_requests!.find((r) => r.id === "h13r")!.status).toBe("new");
  });

  it("nobody sees another house, and a request with no house stays with pastors", async () => {
    seed();
    expect(names(await listCare(otherLeader, now))).toEqual(["House 14"]);
    for (const viewer of [leader, member, otherLeader]) {
      const board = await listCare(viewer, now);
      expect(board.ok && board.requests.some((r) => r.name === "No house" || r.name === "Pastors only")).toBe(false);
    }
  });

  it("only a pastor's visit pulls connect cards and feedback onto the board", async () => {
    tables.connect_responses = [
      { id: "card1", org_id: "org", wants_prayer: true, name: "Card", phone: "000", prayer_request: "x", matched_contact_id: null, submitted_at: "2026-11-18T08:00:00Z" },
    ];
    tables.missio_house_feedback = [{ id: "fb1", house_church_id: "h13", prayer: "Pray for the Mokoena family.", submitted_at: "2026-11-15T08:00:00Z" }];
    const before = await listCare(leader, now);
    expect(before.ok && before.requests).toEqual([]);
    expect(tables.missio_care_requests ?? []).toHaveLength(0);
    await listCare(auth, now);
    const after = await listCare(leader, now);
    expect(after.ok && after.requests.map((r) => [r.source, r.house?.number, r.canStep])).toEqual([["house_feedback", 13, true]]);
  });
});
