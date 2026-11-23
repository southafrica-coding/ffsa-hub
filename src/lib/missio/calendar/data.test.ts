import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

vi.mock("server-only", () => ({}));

import {
  calendarShare,
  createCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents,
  readCalendarByToken,
  updateCalendarEvent,
} from "./data";
import { CALENDAR_TOKEN_PATTERN, deriveCalendarToken, hashCalendarToken, tokenFromSegment } from "./token";

// In-memory stand-ins. Isolated fixtures in this test only; nothing here
// touches a real database.

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

function fakeDb(tables: Tables, opts: { missing?: boolean; userId?: string } = {}) {
  const log: { table: string; op: string; payload?: unknown }[] = [];
  let seq = 0;
  function from(table: string) {
    const filters: [string, unknown][] = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row | null = null;
    const rows = () => (tables[table] ??= []).filter((row) => filters.every(([col, val]) => row[col] === val));
    const run = () => {
      if (opts.missing) return { data: null, error: { code: "PGRST205", message: "missing" } };
      if (op === "insert") {
        const row = { id: `00000000-0000-4000-8000-00000000000${++seq}`, ...payload };
        (tables[table] ??= []).push(row);
        log.push({ table, op, payload });
        return { data: [row], error: null };
      }
      if (op === "update") {
        const hit = rows();
        for (const row of hit) Object.assign(row, payload);
        log.push({ table, op, payload });
        return { data: hit, error: null };
      }
      if (op === "delete") {
        const hit = rows();
        tables[table] = (tables[table] ?? []).filter((row) => !hit.includes(row));
        log.push({ table, op });
        return { data: hit, error: null };
      }
      return { data: rows(), error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: (value: Row) => ((op = "insert"), (payload = value), builder),
      update: (value: Row) => ((op = "update"), (payload = value), builder),
      delete: () => ((op = "delete"), builder),
      eq: (col: string, val: unknown) => (filters.push([col, val]), builder),
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => {
        const out = run();
        return { data: out.error ? null : ((out.data as Row[])[0] ?? null), error: out.error };
      },
      single: async () => {
        const out = run();
        return { data: out.error ? null : (out.data as Row[])[0], error: out.error };
      },
      then: (resolve: (value: unknown) => void) => resolve(run()),
    };
    return builder;
  }
  async function rpc(name: string, args: { p_token_hash: string }) {
    if (opts.missing) return { data: null, error: { code: "PGRST202", message: "missing" } };
    expect(name).toBe("missio_calendar_feed");
    const link = (tables.missio_calendar_links ?? []).find((row) => row.token_hash === args.p_token_hash);
    if (!link) return { data: null, error: null };
    const calendar = (tables.missio_calendars ?? []).find((row) => row.id === link.calendar_id)!;
    return {
      data: { name: calendar.name, events: (tables.missio_calendar_events ?? []).filter((row) => row.calendar_id === calendar.id) },
      error: null,
    };
  }
  return { from, rpc, log };
}

const ORG = "11111111-1111-4111-8111-111111111111";
const PASTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SECRET = "x".repeat(40);

let tables: Tables;
let db: ReturnType<typeof fakeDb>;
const auth = () => ({ user: { id: PASTOR }, orgId: ORG, roles: ["pastor"], supabase: db });

beforeEach(() => {
  vi.stubEnv("MISSIO_AVAILABILITY_TOKEN_SECRET", SECRET);
  tables = {};
  db = fakeDb(tables);
});

describe("share link", () => {
  it("makes a 256-bit token, stores only its nonce and SHA-256, and gives the same link again", async () => {
    const first = await calendarShare(auth(), db, "https://hub.example", false);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const token = first.share.feedUrl.match(/calendar\/([^/.]+)\.ics$/)![1]!;
    expect(token).toMatch(CALENDAR_TOKEN_PATTERN);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(first.share.feedUrl).toBe(`https://hub.example/api/serve/missio/calendar/${token}.ics`);
    expect(first.share.webUrl).toBe(`https://hub.example/serve/missio/calendar/${token}`);
    expect(first.share.prefix).toBe(token.slice(0, 6));

    const [link] = tables.missio_calendar_links!;
    expect(link!.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(tables)).not.toContain(token);
    expect(deriveCalendarToken(SECRET, link!.calendar_id as string, link!.nonce as string)).toBe(token);
    // The calendar was made on the way, once.
    expect(tables.missio_calendars).toHaveLength(1);
    expect(tables.missio_calendars![0]).toMatchObject({ org_id: ORG, name: "Missio", created_by: PASTOR });

    const again = await calendarShare(auth(), db, "https://hub.example", false);
    expect(again.ok && again.share.feedUrl).toBe(first.share.feedUrl);
    expect(tables.missio_calendars).toHaveLength(1);
  });

  it("reset makes a new token and the old one stops working at once", async () => {
    const first = await calendarShare(auth(), db, "https://hub.example", false);
    const oldToken = first.ok ? first.share.feedUrl.match(/calendar\/([^/.]+)\.ics$/)![1]! : "";
    expect((await readCalendarByToken(db, oldToken)).ok).toBe(true);

    const reset = await calendarShare(auth(), db, "https://hub.example", true, new Date("2026-11-23T13:00:00Z"));
    expect(reset.ok).toBe(true);
    if (!reset.ok) return;
    const newToken = reset.share.feedUrl.match(/calendar\/([^/.]+)\.ics$/)![1]!;
    expect(newToken).not.toBe(oldToken);
    expect(reset.share.rotatedAt).toBe("2026-11-23T13:00:00.000Z");
    expect(tables.missio_calendar_links).toHaveLength(1);

    const old = await readCalendarByToken(db, oldToken);
    expect(old).toMatchObject({ ok: false, status: 404 });
    expect((await readCalendarByToken(db, newToken)).ok).toBe(true);
  });

  it("is not available without the server secret", async () => {
    vi.stubEnv("MISSIO_AVAILABILITY_TOKEN_SECRET", "");
    expect(await calendarShare(auth(), db, "https://hub.example", false)).toMatchObject({ ok: false, status: 503, code: "not_available" });
  });

  it("says not available, not 500, before migration 395", async () => {
    const missing = fakeDb({}, { missing: true });
    const a = { ...auth(), supabase: missing };
    expect(await calendarShare(a, missing, "https://hub.example", false)).toMatchObject({ status: 503, code: "not_available" });
    expect(await listCalendarEvents(a)).toEqual({ ok: true, available: false, events: [] });
    expect(await createCalendarEvent(a, { title: "Camp", category: "events", startsOn: "2027-04-02" })).toMatchObject({ status: 503 });
    expect(await readCalendarByToken(missing, "a".repeat(43))).toMatchObject({ status: 404 });
  });
});

describe("feed lookup", () => {
  it("is a plain not found for junk, a wrong token or a missing calendar", async () => {
    expect(await readCalendarByToken(db, "short")).toMatchObject({ ok: false, status: 404 });
    expect(await readCalendarByToken(db, "a".repeat(43))).toMatchObject({ ok: false, status: 404 });
  });

  it("reads the segment with or without .ics", () => {
    const token = "A".repeat(43);
    expect(tokenFromSegment(`${token}.ics`)).toBe(token);
    expect(tokenFromSegment(token)).toBe(token);
    expect(tokenFromSegment("../etc.ics")).toBeNull();
    expect(hashCalendarToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("events", () => {
  it("adds, edits and deletes in the pastor's org, recording who", async () => {
    const made = await createCalendarEvent(auth(), {
      title: "Leaders' night",
      category: "leaders",
      campus: "potch",
      startsOn: "2026-12-01",
      endsOn: "2026-12-01",
      startTime: "18:30",
      endTime: "20:00",
      repeat: { every: 4, count: 6 },
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(tables.missio_calendar_events![0]).toMatchObject({ org_id: ORG, created_by: PASTOR, updated_by: PASTOR, repeat_weekly_interval: 4 });

    const edited = await updateCalendarEvent(auth(), made.event.id, {
      title: "Leaders’ night",
      category: "leaders",
      startsOn: "2026-12-01",
      endsOn: "2026-12-01",
    });
    expect(edited.ok && edited.event.repeat).toBeNull();
    expect(db.log.some((entry) => entry.op === "update" && (entry.payload as Row).updated_by === PASTOR)).toBe(true);

    expect(await updateCalendarEvent(auth(), "not-a-uuid", { title: "x" })).toMatchObject({ status: 404 });
    expect(await deleteCalendarEvent(auth(), made.event.id)).toEqual({ ok: true });
    expect(await deleteCalendarEvent(auth(), made.event.id)).toMatchObject({ status: 404 });
  });

  it("refuses a bad event with field errors before touching the database", async () => {
    const out = await createCalendarEvent(auth(), { title: "", category: "national", startsOn: "nope" });
    expect(out).toMatchObject({ ok: false, status: 400, code: "invalid_input" });
    expect(db.log).toHaveLength(0);
  });
});
