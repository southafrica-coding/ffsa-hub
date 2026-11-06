import { ApiError, createApiFetch } from "@/lib/api";

import { MEDIA } from "../__fixtures__/fixtures";
import { approveMember, getMinistries, getMinistriesAccess, getMinistry, isForbidden, loadErrorMessage } from "../api";
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

describe("GET /api/mobile/ministries", () => {
  it("sends the bearer token and parses tolerantly (an odd row is skipped, not fatal)", async () => {
    const { apiFetch, calls } = server(() => ({
      body: {
        scope: "something-new",
        canCreate: "yes",
        ministries: [
          { id: MEDIA, name: "Media", description: "", isActive: true, ministryType: "weekend", peopleCount: 3, extra: 1 },
          { id: 42 },
        ],
      },
    }));
    const out = await getMinistries(apiFetch);
    expect(calls[0].url).toBe("https://hub.test/api/mobile/ministries");
    expect(new Headers(calls[0].init.headers).get("Authorization")).toBe("Bearer tok");
    expect(out).toEqual({
      scope: "led",
      canCreate: false,
      ministries: [{ id: MEDIA, name: "Media", description: null, isActive: true, ministryType: "main", peopleCount: 3 }],
    });
  });

  it("a 403 is the forbidden kind, with its own words", async () => {
    const { apiFetch } = server(() => ({ status: 403, body: { error: "Not authorized" } }));
    const err = await getMinistries(apiFetch).catch((e: unknown) => e);
    expect(isForbidden(err)).toBe(true);
    expect(loadErrorMessage(err)).toBe(strings.common.forbidden);
  });
});

describe("GET /api/mobile/ministries/[id]", () => {
  it("encodes the id and fills safe defaults", async () => {
    const { apiFetch, calls } = server(() => ({
      body: {
        ministry: { id: MEDIA, name: "Media", isActive: false, ministryType: "part_time" },
        canManage: true,
        roster: [{ membershipId: "m1", name: "Ann", role: "boss", status: "pending" }],
      },
    }));
    const out = await getMinistry(apiFetch, "a/b");
    expect(calls[0].url).toBe("https://hub.test/api/mobile/ministries/a%2Fb");
    expect(out.subcategories).toEqual([]);
    expect(out.ministry.description).toBeNull();
    expect(out.roster[0]).toEqual({
      membershipId: "m1",
      userId: null,
      name: "Ann",
      email: null,
      role: "member",
      status: "pending",
      isPointLeader: false,
      categoryIds: [],
      pointLeaderCategoryIds: [],
    });
  });

  it("404 / 400 read as 'doesn't exist any more'", async () => {
    const { apiFetch } = server(() => ({ status: 404, body: { error: "not_found" } }));
    expect(loadErrorMessage(await getMinistry(apiFetch, MEDIA).catch((e: unknown) => e))).toBe(strings.common.notFound);
  });
});

describe("access probe and approve", () => {
  it("probe returns canView", async () => {
    const { apiFetch, calls } = server(() => ({ body: { canView: true, scope: "led" } }));
    expect(await getMinistriesAccess(apiFetch)).toBe(true);
    expect(calls[0].url).toBe("https://hub.test/api/mobile/ministries/access");
  });

  it("approve PATCHes the website's own roster endpoint with the membership id", async () => {
    const { apiFetch, calls } = server(() => ({ body: { success: true } }));
    await approveMember(apiFetch, MEDIA, "m9");
    expect(calls[0].url).toBe(`https://hub.test/api/ministries/${MEDIA}/members`);
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ membership_id: "m9" });
  });

  it("network failures get the connection message", () => {
    expect(loadErrorMessage(new ApiError("network", "x"))).toBe(strings.common.network);
    expect(loadErrorMessage(new Error("??"))).toBe(strings.common.generic);
  });
});
