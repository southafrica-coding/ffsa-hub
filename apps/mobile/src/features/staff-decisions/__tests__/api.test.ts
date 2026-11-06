import { ApiError, createApiFetch } from "@/lib/api";

import { LT_2026 } from "../__fixtures__/fixtures";
import { actionErrorMessage, getSchool, getSchools, loadErrorMessage, makeStaff, recordDecision } from "../api";
import { strings } from "../strings";

// API contract: real createApiFetch, fake network. Checks paths, verbs,
// bodies, the bearer header, and tolerant parsing of the server's JSON.

function server(respond: (url: string, init: RequestInit) => { status?: number; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = respond(url, init);
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  const apiFetch = createApiFetch({ baseUrl: "https://hub.test", getAccessToken: async () => "tok", onAuthFailure: jest.fn(), fetchImpl });
  return { apiFetch, calls };
}

describe("GET /api/mobile/staff-decisions", () => {
  it("sends the bearer token and parses tolerantly (an odd row is skipped, not fatal)", async () => {
    const { apiFetch, calls } = server(() => ({
      body: {
        schools: [
          { id: LT_2026, name: "LT 2026", status: "active", archived: "no", total: 3, yes: 1, no: -1, undecided: 1, extra: true },
          { id: 42 },
        ],
      },
    }));
    const out = await getSchools(apiFetch);
    expect(calls[0].url).toBe("https://hub.test/api/mobile/staff-decisions");
    expect(new Headers(calls[0].init.headers).get("Authorization")).toBe("Bearer tok");
    expect(out).toEqual({
      schools: [{ id: LT_2026, name: "LT 2026", status: "active", archived: false, total: 3, yes: 1, no: 0, undecided: 1 }],
    });
  });

  it("a 403 is the forbidden kind, with its own words", async () => {
    const { apiFetch } = server(() => ({ status: 403, body: { error: "Not authorized" } }));
    const err = await getSchools(apiFetch).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(loadErrorMessage(err)).toBe(strings.common.forbidden);
  });
});

describe("GET /api/mobile/staff-decisions/[programId]", () => {
  it("encodes the id; parses rows, decisions and department options tolerantly", async () => {
    const { apiFetch, calls } = server(() => ({
      body: {
        school: { id: LT_2026, name: "LT 2026", status: "active", archived: false, total: 2, yes: 1, no: 0, undecided: 1 },
        rows: [
          { enrollmentId: "e1", userId: "s1", name: "Ann", email: "", status: "arrived", isStaff: false, department: null, decision: { accepted: true, note: "", decidedAt: "2026-10-01T10:00:00Z", decidedByName: null } },
          { enrollmentId: "e2", userId: null, name: "Bo", decision: { accepted: "maybe" } },
          { name: "no id" },
        ],
        departmentOptions: "oops",
      },
    }));
    const out = await getSchool(apiFetch, "a/b");
    expect(calls[0].url).toBe("https://hub.test/api/mobile/staff-decisions/a%2Fb");
    expect(out.rows).toEqual([
      { enrollmentId: "e1", userId: "s1", name: "Ann", email: null, status: "arrived", isStaff: false, department: null, decision: { accepted: true, note: null, decidedAt: "2026-10-01T10:00:00Z", decidedByName: null } },
      { enrollmentId: "e2", userId: null, name: "Bo", email: null, status: "", isStaff: false, department: null, decision: null },
    ]);
    expect(out.departmentOptions).toEqual([]);
  });

  it("404 / 400 read as 'not a Leadership Track school'; offline gets the connection words", async () => {
    for (const status of [404, 400]) {
      const { apiFetch } = server(() => ({ status, body: { error: "not_found" } }));
      expect(loadErrorMessage(await getSchool(apiFetch, LT_2026).catch((e: unknown) => e))).toBe(strings.common.notFound);
    }
    expect(loadErrorMessage(new ApiError("network", "x"))).toBe(strings.common.network);
    expect(loadErrorMessage(new Error("x"))).toBe(strings.common.generic);
  });
});

describe("writes go to the website's own endpoints", () => {
  it("records a decision with a trimmed note", async () => {
    const { apiFetch, calls } = server(() => ({ body: { success: true } }));
    await recordDecision(apiFetch, { enrollmentId: "e1", accepted: false, note: "  Not yet  " });
    expect(calls[0].url).toBe("https://hub.test/api/schools/staff-decisions");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ enrollment_id: "e1", accepted: false, note: "Not yet" });
  });

  it("makes staff with a department, or an empty one for 'choose later'", async () => {
    const { apiFetch, calls } = server(() => ({ body: { success: true } }));
    await makeStaff(apiFetch, { enrollmentId: "e1", department: "media" });
    await makeStaff(apiFetch, { enrollmentId: "e1", department: null });
    expect(calls[0].url).toBe("https://hub.test/api/schools/staff-decisions/make-staff");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ enrollment_id: "e1", department: "media" });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ enrollment_id: "e1", department: "" });
  });

  it("failure words: forbidden, a rule the server enforced, or a connection problem", () => {
    const sh = strings.sheet;
    expect(actionErrorMessage(new ApiError("forbidden", "x", 403), "decide")).toBe(sh.forbidden);
    expect(actionErrorMessage(new ApiError("http", "x", 400), "decide")).toBe(sh.saveRejected);
    expect(actionErrorMessage(new ApiError("http", "x", 400), "makeStaff")).toBe(sh.makeStaffRejected);
    expect(actionErrorMessage(new ApiError("network", "x"), "decide")).toBe(sh.saveFailed);
    expect(actionErrorMessage(new ApiError("http", "x", 500), "makeStaff")).toBe(sh.makeStaffFailed);
  });
});
