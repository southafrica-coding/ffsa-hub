import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};

function from(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let action: "select" | "insert" | "update" | "upsert" = "select";
  let payload: Row | null = null;
  let limitN = Infinity;
  let order: { col: string; asc: boolean } | null = null;
  const rows = () => (tables[table] ??= []);
  const run = () => {
    if (action === "insert") {
      const row = { id: `id-${rows().length + 1}`, ...payload };
      rows().push(row);
      return [row];
    }
    if (action === "update") {
      const hit = rows().filter((row) => filters.every((f) => f(row)));
      for (const row of hit) Object.assign(row, payload);
      return hit;
    }
    if (action === "upsert") {
      const existing = rows().find((row) => row.house_church_id === payload!.house_church_id && row.meeting_date === payload!.meeting_date);
      if (existing) {
        Object.assign(existing, payload);
        return [existing];
      }
      const row = { id: `fb-${rows().length + 1}`, ...payload };
      rows().push(row);
      return [row];
    }
    let out = rows().filter((row) => filters.every((f) => f(row)));
    if (order) {
      const { col, asc } = order;
      out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
    }
    return out.slice(0, limitN);
  };
  const b = {
    select: () => b,
    insert: (value: Row) => ((action = "insert"), (payload = value), b),
    update: (value: Row) => ((action = "update"), (payload = value), b),
    upsert: (value: Row) => ((action = "upsert"), (payload = value), b),
    eq: (col: string, val: unknown) => (filters.push((row) => row[col] === val), b),
    lte: (col: string, val: string) => (filters.push((row) => String(row[col]) <= val), b),
    order: (col: string, opts: { ascending: boolean }) => ((order = { col, asc: opts.ascending }), b),
    limit: (n: number) => ((limitN = n), b),
    maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
    single: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(resolve),
  };
  return b;
}
const db = { from };

const { houseFeedbackLink, loadPublicFeedback, meetingDateFor, savePublicFeedback } = await import("./feedback");

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key];
  process.env.MISSIO_AVAILABILITY_TOKEN_SECRET = "a-test-secret-that-is-long-enough-for-hmac";
  tables.house_churches = [{ id: "h5", number: 5, name: null, meeting_day: "wednesday" }];
});

const raw = (path: string) => path.split("/").pop() as string;

describe("weekly feedback", () => {
  it("works out the last meeting on or before today, in Johannesburg", () => {
    // Thursday 19 Nov 2026, 08:00 in Johannesburg.
    const thursday = new Date("2026-11-19T06:00:00Z");
    expect(meetingDateFor("wednesday", thursday)).toBe("2026-11-18");
    expect(meetingDateFor("thursday", thursday)).toBe("2026-11-19");
    expect(meetingDateFor("friday", thursday)).toBe("2026-11-13");
    expect(meetingDateFor(null, thursday)).toBe("2026-11-19");
  });

  it("makes one link per house, gives the same link again, and rotates it", async () => {
    const first = await houseFeedbackLink(db, "h5", "pastor");
    const again = await houseFeedbackLink(db, "h5", "pastor");
    if (!first.ok || !again.ok) throw new Error("expected links");
    expect(again.path).toBe(first.path);
    expect(tables.missio_feedback_links).toHaveLength(1);
    expect(JSON.stringify(tables.missio_feedback_links)).not.toContain(raw(first.path));

    const rotated = await houseFeedbackLink(db, "h5", "pastor", true);
    if (!rotated.ok) throw new Error("expected a link");
    expect(rotated.path).not.toBe(first.path);
    expect((await loadPublicFeedback(db, raw(first.path))).ok).toBe(false);
    expect((await loadPublicFeedback(db, raw(rotated.path))).ok).toBe(true);
  });

  it("saves this week's answers once, updates them on a second send, and starts from last week's count", async () => {
    const link = await houseFeedbackLink(db, "h5", "pastor");
    if (!link.ok) throw new Error("expected a link");
    const token = raw(link.path);
    const lastWeek = new Date("2026-11-12T06:00:00Z");
    const thisWeek = new Date("2026-11-19T06:00:00Z");

    expect((await savePublicFeedback(db, token, { attendance: 21, mood: "good" }, lastWeek)).ok).toBe(true);
    const view = await loadPublicFeedback(db, token, thisWeek);
    if (!view.ok) throw new Error("expected a view");
    expect(view.view).toMatchObject({ houseTitle: "House 5", meetingDate: "2026-11-18", lastAttendance: 21, existing: null });

    const body = { attendance: 22, mood: "great", newNames: ["Thabo Nkosi", "Thabo Nkosi"], prayer: "Thabo’s mom", notes: "" };
    const saved = await savePublicFeedback(db, token, body, thisWeek);
    if (!saved.ok) throw new Error("expected a save");
    expect(saved.entry).toMatchObject({ meetingDate: "2026-11-18", attendance: 22, newNames: ["Thabo Nkosi"], notes: null });
    expect((await savePublicFeedback(db, token, { ...body, attendance: 23 }, thisWeek)).ok).toBe(true);
    expect(tables.missio_house_feedback).toHaveLength(2);
    const again = await loadPublicFeedback(db, token, thisWeek);
    expect(again.ok && again.view.existing?.attendance).toBe(23);
  });

  it("refuses a bad token and bad answers", async () => {
    expect(await loadPublicFeedback(db, "short")).toMatchObject({ ok: false, code: "invalid_token" });
    expect(await savePublicFeedback(db, "A".repeat(43), { attendance: 3, mood: "good" })).toMatchObject({ ok: false, code: "invalid_token" });
    const link = await houseFeedbackLink(db, "h5", "pastor");
    if (!link.ok) throw new Error("expected a link");
    expect(await savePublicFeedback(db, raw(link.path), { attendance: -1, mood: "good" })).toMatchObject({ ok: false, code: "invalid_input" });
    expect(await savePublicFeedback(db, raw(link.path), { attendance: 3, mood: "meh" })).toMatchObject({ ok: false, code: "invalid_input" });
  });
});
