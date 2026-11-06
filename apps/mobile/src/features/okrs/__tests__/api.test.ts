import { ApiError, createApiFetch } from "@/lib/api";

import { checkin, ownerPage, wall } from "../__fixtures__/fixtures";
import { createOkrsApi } from "../api";

function setup(respond: (url: string, init: RequestInit) => { status?: number; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = respond(url, init);
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  const api = createOkrsApi(
    createApiFetch({ baseUrl: "https://hub.test", getAccessToken: async () => "tok", onAuthFailure: jest.fn(), fetchImpl }),
  );
  return { api, calls };
}

describe("okrs api", () => {
  it("reads the wall with the bearer token, with or without a cycle", async () => {
    const { api, calls } = setup(() => ({ body: { ...wall(), extra: "ignored" } }));
    const w = await api.loadWall(null);
    expect(w.cycle?.slug).toBe("2026");
    await api.loadWall("2025 q1");
    expect(calls.map((c) => c.url)).toEqual(["https://hub.test/api/mobile/okrs", "https://hub.test/api/mobile/okrs?cycle=2025%20q1"]);
    expect(new Headers(calls[0].init.headers).get("Authorization")).toBe("Bearer tok");
  });

  it("reads one group's page", async () => {
    const { api, calls } = setup(() => ({ body: ownerPage({ canEdit: true, readOnly: null }) }));
    const page = await api.loadOwner("o-1", "2026");
    expect(page.canEdit).toBe(true);
    expect(calls[0].url).toBe("https://hub.test/api/mobile/okrs/o-1?cycle=2026");
  });

  it("a 404 stays a 404 so the screen can say 'not found'", async () => {
    const { api } = setup(() => ({ status: 404, body: { error: "not_found" } }));
    await expect(api.loadOwner("o-1", null)).rejects.toMatchObject({ kind: "http", status: 404 });
  });

  it("check-ins: one odd row doesn't hide the rest", async () => {
    const { api, calls } = setup(() => ({ body: { checkins: [checkin(), { id: 7 }, checkin({ id: "ch2", value: null, author_name: null })] } }));
    const list = await api.loadCheckins("kr1");
    expect(list.map((c) => c.id)).toEqual(["ch1", "ch2"]);
    expect(calls[0].url).toBe("https://hub.test/api/okrs/key-results/kr1/checkins");
  });

  it("posts a check-in to the website's existing route", async () => {
    const { api, calls } = setup(() => ({ body: { success: true } }));
    await api.postCheckin("kr1", { status: "stuck", value: null, comment: "Blocked on visas" });
    expect(calls[0].url).toBe("https://hub.test/api/okrs/key-results/kr1/checkins");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ status: "stuck", value: null, comment: "Blocked on visas" });
  });

  it("a refusal is a forbidden ApiError", async () => {
    const { api } = setup(() => ({ status: 403, body: { error: "You cannot check in on this key result" } }));
    const err = await api.postCheckin("kr1", { status: "stuck", value: null, comment: null }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: "forbidden" });
  });
});
