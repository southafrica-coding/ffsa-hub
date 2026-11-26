import { beforeEach, describe, expect, it, vi } from "vitest";

// The one public weekly feedback link (/f/missio-weekly-feedback): the
// house list, the house check, the honeypot and the limits. A fake
// database and an in-memory limiter: nothing reaches Supabase.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => null }));
const save = vi.hoisted(() => vi.fn());
vi.mock("./weekly-feedback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./weekly-feedback")>()),
  saveWeeklyFeedback: save,
}));

import { InMemoryRateLimiter } from "@/lib/rate-limit";
import { handlePublicWeeklyFeedback, listPublicHouses, loadPublicHouse } from "./public-feedback";

const ORG = "org-missio";
const H4 = "44444444-4444-4444-8444-444444444444";
const H7 = "77777777-7777-4777-8777-777777777777";
const OTHER_ORG_HOUSE = "99999999-9999-4999-8999-999999999999";
const LIVE = { VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv;

// Rows as the table holds them, with the columns a public page must never show.
const HOUSES = [
  { id: H4, org_id: ORG, number: 4, name: "Sipho & Naledi", meeting_day: null, campus: "potch", location: "12 Secret St", leader_notes: "private" },
  { id: H7, org_id: ORG, number: 7, name: null, meeting_day: "wednesday", campus: "potch", location: "x", leader_notes: "y" },
  { id: OTHER_ORG_HOUSE, org_id: "org-other", number: 1, name: "Not Missio", meeting_day: null, campus: "jhb", location: "", leader_notes: "" },
];

type Q = { table: string; select?: string; filters: Array<[string, unknown]> };
let queries: Q[];

function fakeDb() {
  return {
    from(table: string) {
      const q: Q = { table, filters: [] };
      queries.push(q);
      const b: Record<string, unknown> = {};
      b.select = (cols: string) => ((q.select = cols), b);
      b.eq = (c: string, v: unknown) => (q.filters.push([c, v]), b);
      b.order = () => b;
      const rows = () => {
        if (table === "organisations") return [{ id: ORG, slug: "missio" }].filter((r) => q.filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v));
        if (table === "house_churches") {
          return HOUSES.filter((r) => q.filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v)).map((r) => {
            // Behave like PostgREST: only the selected columns come back.
            const cols = (q.select ?? "*").split(",").map((c) => c.trim());
            return Object.fromEntries(Object.entries(r).filter(([k]) => cols.includes("*") || cols.includes(k)));
          });
        }
        return [];
      };
      b.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve);
      return b;
    },
  };
}

function post(body: unknown, ip = "10.0.0.1") {
  return new Request("http://x/api/f/missio-weekly-feedback/submit", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, "user-agent": "test" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const answers = { attendance: 11 };

beforeEach(() => {
  queries = [];
  save.mockReset();
  save.mockResolvedValue({ ok: true, meetingDate: "2026-11-22", routes: [] });
});

describe("listPublicHouses", () => {
  it("lists every Missio house, number order, with id, number, name and this week's meeting only", async () => {
    // Monday 23 Nov 2026, 09:00 SAST: House 4 (no day) met Sunday 22nd, House 7 Wednesday 18th.
    const houses = await listPublicHouses(fakeDb(), new Date("2026-11-23T07:00:00Z"));
    expect(houses).toEqual([
      { id: H4, number: 4, name: "Sipho & Naledi", meetingDate: "2026-11-22" },
      { id: H7, number: 7, name: null, meetingDate: "2026-11-18" },
    ]);
    for (const h of houses) expect(Object.keys(h).sort()).toEqual(["id", "meetingDate", "name", "number"]);
    const text = JSON.stringify(houses);
    for (const secret of ["Secret", "private", "leader_notes", "location", "Not Missio"]) expect(text).not.toContain(secret);
    // It asks the database for no more than that, scoped to the Missio org.
    const q = queries.find((x) => x.table === "house_churches");
    expect(q?.select).toBe("id, number, name, meeting_day");
    expect(q?.filters).toEqual([["org_id", ORG]]);
    // No members, coaches or people tables are touched.
    expect(queries.map((x) => x.table).sort()).toEqual(["house_churches", "organisations"]);
  });
});

describe("loadPublicHouse", () => {
  it("accepts a Missio house id and nothing else", async () => {
    expect((await loadPublicHouse(fakeDb(), H4))?.id).toBe(H4);
    expect(await loadPublicHouse(fakeDb(), OTHER_ORG_HOUSE)).toBeNull();
    expect(await loadPublicHouse(fakeDb(), "4")).toBeNull();
    expect(await loadPublicHouse(fakeDb(), "House 4")).toBeNull();
    expect(await loadPublicHouse(fakeDb(), undefined)).toBeNull();
    expect(await loadPublicHouse(fakeDb(), "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("handlePublicWeeklyFeedback", () => {
  const deps = () => ({ env: LIVE, limiter: new InMemoryRateLimiter() });

  it("saves against the chosen house through saveWeeklyFeedback (subject = that house)", async () => {
    const res = await handlePublicWeeklyFeedback(post({ houseId: H4, answers, website: "" }), fakeDb(), deps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, meetingDate: "2026-11-22" });
    expect(save).toHaveBeenCalledTimes(1);
    const [, input] = save.mock.calls[0];
    expect(input).toMatchObject({ house: { id: H4, org_id: ORG, number: 4 }, linkId: null, answers, ip: "10.0.0.1" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("requires a house: missing, unknown, malformed or another org's id is a 400 and saves nothing", async () => {
    for (const houseId of [undefined, "", "4", "House 4", OTHER_ORG_HOUSE, "00000000-0000-4000-8000-000000000000", 4]) {
      const res = await handlePublicWeeklyFeedback(post({ houseId, answers }), fakeDb(), deps());
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("invalid_house");
      expect(body.fieldErrors).toHaveProperty("house_church");
    }
    expect(save).not.toHaveBeenCalled();
  });

  it("does not trust a house name or number in the answers", async () => {
    const res = await handlePublicWeeklyFeedback(post({ answers: { ...answers, house_church_id: H4, number: 4 } }), fakeDb(), deps());
    expect(res.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  it("a filled honeypot gets a bland OK and writes nothing, not even a house lookup", async () => {
    const res = await handlePublicWeeklyFeedback(post({ houseId: H4, answers, website: "http://spam" }), fakeDb(), deps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(save).not.toHaveBeenCalled();
    expect(queries).toHaveLength(0);
  });

  it("refuses bad JSON", async () => {
    const res = await handlePublicWeeklyFeedback(post("{nope"), fakeDb(), deps());
    expect(res.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  it("never saves on a preview", async () => {
    const res = await handlePublicWeeklyFeedback(post({ houseId: H4, answers }), fakeDb(), {
      env: { VERCEL_ENV: "preview" } as unknown as NodeJS.ProcessEnv,
      limiter: new InMemoryRateLimiter(),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("preview_writes_disabled");
    expect(save).not.toHaveBeenCalled();
  });

  it("limits one IP to 30 sends in 10 minutes", async () => {
    const d = deps();
    for (let i = 0; i < 30; i++) {
      const ok = await handlePublicWeeklyFeedback(post({ houseId: i % 2 ? H4 : H7, answers }), fakeDb(), d);
      expect(ok.status).toBe(200);
    }
    const res = await handlePublicWeeklyFeedback(post({ houseId: H4, answers }), fakeDb(), d);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(save).toHaveBeenCalledTimes(30);
  });

  it("limits one house to 30 sends in 10 minutes, across IPs", async () => {
    const d = deps();
    for (let i = 0; i < 30; i++) {
      expect((await handlePublicWeeklyFeedback(post({ houseId: H4, answers }, `10.0.1.${i}`), fakeDb(), d)).status).toBe(200);
    }
    expect((await handlePublicWeeklyFeedback(post({ houseId: H4, answers }, "10.0.2.1"), fakeDb(), d)).status).toBe(429);
    // Another house is not held up.
    expect((await handlePublicWeeklyFeedback(post({ houseId: H7, answers }, "10.0.2.2"), fakeDb(), d)).status).toBe(200);
  });

  it("passes the save's own refusal through (e.g. missing answers)", async () => {
    save.mockResolvedValueOnce({ ok: false, status: 400, code: "invalid_input", error: "Check the answers marked below.", fieldErrors: { attendance: "x" } });
    const res = await handlePublicWeeklyFeedback(post({ houseId: H4, answers: {} }), fakeDb(), deps());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_input", fieldErrors: { attendance: "x" } });
  });
});
