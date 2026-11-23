import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

// The calendar routes are pastors only. requireOrgRole is the gate
// (has_org_role + org_staff_roles; an FFSA admin is not a pass); these tests
// check that every route asks it for the pastor role and stops on a refusal
// before any data call.

const state = vi.hoisted(() => ({
  refusal: null as null | 401 | 403,
  askedRoles: [] as unknown[],
  calls: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/missio/access", () => ({
  MISSIO_SLUG: "missio",
  MISSIO_PEOPLE_ROLES: ["pastor"],
  requireOrgRole: async (_slug: string, roles: readonly string[]) => {
    state.askedRoles.push(roles);
    if (state.refusal === 401) return { response: NextResponse.json({ code: "unauthenticated" }, { status: 401 }) };
    if (state.refusal === 403) return { response: NextResponse.json({ code: "forbidden" }, { status: 403 }) };
    return { user: { id: "pastor-1" }, orgId: "org-1", roles: ["pastor"], supabase: {} };
  },
}));
vi.mock("@/lib/missio/calendar/limit", () => ({ calendarPastorLimit: async () => null, calendarFeedLimit: async () => null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ admin: true }) }));
vi.mock("@/lib/missio/calendar/data", () => ({
  listCalendarEvents: async () => (state.calls.push("list"), { ok: true, available: false, events: [] }),
  createCalendarEvent: async () => (state.calls.push("create"), { ok: true, event: { id: "e1" } }),
  updateCalendarEvent: async () => (state.calls.push("update"), { ok: true, event: { id: "e1" } }),
  deleteCalendarEvent: async () => (state.calls.push("delete"), { ok: true }),
  calendarShare: async (_a: unknown, _admin: unknown, origin: string, reset: boolean) => (
    state.calls.push(`share:${reset}`),
    { ok: true, share: { feedUrl: `${origin}/api/serve/missio/calendar/T.ics`, webUrl: "", prefix: "T", rotatedAt: null } }
  ),
  publicFeedClient: () => ({}),
  readCalendarByToken: async (_db: unknown, raw: string) =>
    raw === "G".repeat(43)
      ? {
          ok: true,
          name: "Missio",
          events: [
            {
              id: "e1",
              title: "Camp",
              description: null,
              location: null,
              category: "events",
              campus: "jhb",
              startsOn: "2027-04-02",
              endsOn: "2027-04-05",
              startTime: null,
              endTime: null,
              repeat: null,
              skipDates: [],
              source: "missio",
            },
          ],
        }
      : { ok: false, status: 404, code: "not_found", error: "Not found." },
}));

import { GET as list } from "./route";
import { POST as create } from "./events/route";
import { DELETE as remove, PATCH as update } from "./events/[id]/route";
import { POST as share } from "./share/route";
import { GET as feed } from "../../serve/missio/calendar/[feed]/route";

const ctx = { params: Promise.resolve({ id: "e1" }) };
const post = (body: unknown) => new Request("https://hub.example/api", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  state.refusal = null;
  state.askedRoles = [];
  state.calls = [];
  vi.unstubAllEnvs();
});

describe("pastor gate", () => {
  const routes: Array<[string, () => Promise<Response>]> = [
    ["GET calendar", () => list()],
    ["POST event", () => create(post({ title: "x" }))],
    ["PATCH event", () => update(post({ title: "x" }), ctx)],
    ["DELETE event", () => remove(new Request("https://hub.example/api", { method: "DELETE" }), ctx)],
    ["POST share", () => share(post({ reset: true }))],
  ];

  it.each(routes)("%s asks for the pastor role", async (_name, run) => {
    const res = await run();
    expect(res.status).toBeLessThan(300);
    expect(state.askedRoles).toEqual([["pastor"]]);
  });

  it.each(routes)("%s stops a leader or coach (403) before any data call", async (_name, run) => {
    state.refusal = 403;
    const res = await run();
    expect(res.status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it.each(routes)("%s stops someone signed out (401)", async (_name, run) => {
    state.refusal = 401;
    expect((await run()).status).toBe(401);
    expect(state.calls).toEqual([]);
  });

  it("passes reset through and builds the link on the public host", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.ffsahub.com/");
    const res = await share(post({ reset: true }));
    expect(state.calls).toEqual(["share:true"]);
    expect((await res.json()).share.feedUrl).toBe("https://www.ffsahub.com/api/serve/missio/calendar/T.ics");
    await share(new Request("https://hub.example/api", { method: "POST" }));
    expect(state.calls).toEqual(["share:true", "share:false"]);
  });

  it("rejects a body that isn't JSON", async () => {
    const res = await create(new Request("https://hub.example/api", { method: "POST", body: "{" }));
    expect(res.status).toBe(400);
  });
});

describe("public feed", () => {
  const get = (segment: string, query = "") =>
    feed(new Request(`https://hub.example/api/serve/missio/calendar/${segment}${query}`), { params: Promise.resolve({ feed: segment }) });

  it("serves text/calendar for the right token, holidays included", async () => {
    const res = await get(`${"G".repeat(43)}.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    const body = await res.text();
    expect(body).toContain("X-WR-CALNAME:Missio");
    expect(body).toContain("SUMMARY:Camp (JHB)");
    expect(body).toContain("UID:za-holiday-2026-12-25@missio.ffsahub");
  });

  it("leaves national dates out with ?national=0", async () => {
    const body = await (await get(`${"G".repeat(43)}.ics`, "?national=0")).text();
    expect(body).toContain("SUMMARY:Camp (JHB)");
    expect(body).not.toContain("za-holiday");
  });

  it("is the same plain 404 for a wrong, reset or malformed token", async () => {
    for (const segment of [`${"W".repeat(43)}.ics`, "nope.ics", "x"]) {
      const res = await get(segment);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not found");
    }
  });
});
