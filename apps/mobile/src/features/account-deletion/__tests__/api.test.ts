import { ApiError, createApiFetch } from "@/lib/api";

import { cancelDeletion, cleanReason, getDeletionRequest, requestDeletion } from "../api";

type Call = { url: string; method: string; body: unknown; auth: string | null };

function client(respond: (call: Call) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  const apiFetch = createApiFetch({
    baseUrl: "https://hub.test",
    getAccessToken: async () => "tok",
    onAuthFailure: jest.fn(),
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const call: Call = {
        url: String(input),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        auth: headers.get("Authorization"),
      };
      calls.push(call);
      const r = respond(call);
      return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status });
    }) as typeof fetch,
  });
  return { apiFetch, calls };
}

describe("account deletion api", () => {
  it("GET: the open request, with the bearer token", async () => {
    const { apiFetch, calls } = client(() => ({
      status: 200,
      body: { request: { id: "r1", status: "open", reason: null, requestedAt: "2026-11-03T10:00:00Z" }, contactEmail: "o@x.org" },
    }));
    expect(await getDeletionRequest(apiFetch)).toEqual({
      request: { requestedAt: "2026-11-03T10:00:00Z", reason: null, recorded: true },
      contactEmail: "o@x.org",
    });
    expect(calls[0]).toMatchObject({ url: "https://hub.test/api/account/deletion-request", method: "GET", auth: "Bearer tok" });
  });

  it("GET: none open (or table not there yet)", async () => {
    const { apiFetch } = client(() => ({ status: 200, body: { request: null } }));
    expect(await getDeletionRequest(apiFetch)).toEqual({ request: null, contactEmail: null });
  });

  it("POST: confirm:true, source app, trimmed reason; never a user id", async () => {
    const { apiFetch, calls } = client(() => ({
      status: 201,
      body: { request: { id: "r1", status: "open", reason: "bye", requestedAt: "2026-11-03T10:00:00Z" }, recorded: true },
    }));
    const res = await requestDeletion(apiFetch, "  bye  ");
    expect(calls[0]).toMatchObject({ method: "POST", body: { confirm: true, reason: "bye", source: "app" } });
    expect(Object.keys(calls[0].body as object).sort()).toEqual(["confirm", "reason", "source"]);
    expect(res.request).toEqual({ requestedAt: "2026-11-03T10:00:00Z", reason: "bye", recorded: true });
  });

  it("POST 202 recorded:false is still a request", async () => {
    const { apiFetch } = client(() => ({
      status: 202,
      body: { request: { id: null, status: "open", reason: null, requestedAt: "2026-11-03T10:00:00Z" }, recorded: false, notified: true },
    }));
    expect((await requestDeletion(apiFetch, "")).request).toMatchObject({ recorded: false });
  });

  it("POST 200 already open (no recorded field) counts as saved", async () => {
    const { apiFetch } = client(() => ({
      status: 200,
      body: { request: { id: "r0", status: "open", reason: null, requestedAt: "2026-11-01T10:00:00Z" }, alreadyRequested: true },
    }));
    expect((await requestDeletion(apiFetch, "")).request).toMatchObject({ recorded: true, requestedAt: "2026-11-01T10:00:00Z" });
  });

  it("POST 503 throws with the status, so the screen can say who to email", async () => {
    const { apiFetch } = client(() => ({ status: 503, body: { error: "email us" } }));
    await expect(requestDeletion(apiFetch, "")).rejects.toMatchObject({ kind: "http", status: 503 });
  });

  it("DELETE: 200 and 404 are both fine; 409 throws", async () => {
    let status = 200;
    const { apiFetch, calls } = client(() => ({ status, body: {} }));
    await expect(cancelDeletion(apiFetch)).resolves.toBeUndefined();
    expect(calls[0].method).toBe("DELETE");
    status = 404;
    await expect(cancelDeletion(apiFetch)).resolves.toBeUndefined();
    status = 409;
    await expect(cancelDeletion(apiFetch)).rejects.toBeInstanceOf(ApiError);
  });

  it("cleanReason trims, drops empty and caps at 1000", () => {
    expect(cleanReason("   ")).toBeNull();
    expect(cleanReason(" a ")).toBe("a");
    expect(cleanReason("x".repeat(1200))).toHaveLength(1000);
  });
});
