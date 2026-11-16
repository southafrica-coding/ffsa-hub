import { z } from "zod";

import { ApiError, createApiFetch, DEACTIVATED_MESSAGE, displayName, getMe, meSchema, type ApiDeps } from "../api";

const BASE = "https://hub.example.test";

function jsonResponse(status: number, body: unknown) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setup(overrides: Partial<ApiDeps> = {}) {
  const fetchImpl = jest.fn<Promise<Response>, [string, RequestInit]>();
  const onAuthFailure = jest.fn();
  const deps: ApiDeps = {
    baseUrl: BASE,
    getAccessToken: async () => "access-token-123",
    onAuthFailure,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...overrides,
  };
  return { apiFetch: createApiFetch(deps), fetchImpl, onAuthFailure };
}

const ME = {
  user: { id: "u1", email: "jo@example.org" },
  profile: { firstName: "Sample", lastName: "Person", preferredName: "Sample", avatarUrl: null, isActive: true },
  roles: [
    { name: "staff", scopeType: null, scopeId: null },
    { name: "team_leader", scopeType: "outreach_team", scopeId: "t1" },
  ],
  permissions: [
    { key: "finance.view", scopeType: null, scopeId: null, source: "role" },
    { key: "events.manage", scopeType: null, scopeId: null, source: "direct" },
  ],
  serverTime: "2026-11-02T08:00:00.000Z",
};

describe("apiFetch", () => {
  it("sends the bearer token and Accept header to the base URL", async () => {
    const { apiFetch, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(jsonResponse(200, { ok: true }));

    await expect(apiFetch("/api/ping")).resolves.toEqual({ ok: true });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${BASE}/api/ping`);
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer access-token-123");
    expect(headers.get("Accept")).toBe("application/json");
    expect(init.signal).toBeDefined();
  });

  it("adds a leading slash and JSON-encodes bodies", async () => {
    const { apiFetch, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(jsonResponse(200, {}));
    await apiFetch("api/things", { method: "POST", body: { a: 1 } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${BASE}/api/things`);
    expect(init.body).toBe('{"a":1}');
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });

  it("doesn't call the server without a session, and signs out", async () => {
    const { apiFetch, fetchImpl, onAuthFailure } = setup({ getAccessToken: async () => null });
    await expect(apiFetch("/api/me")).rejects.toMatchObject({ kind: "unauthenticated" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onAuthFailure).toHaveBeenCalledWith("unauthenticated");
  });

  it("maps 401 {error: unauthenticated} to sign-out", async () => {
    const { apiFetch, fetchImpl, onAuthFailure } = setup();
    fetchImpl.mockResolvedValue(jsonResponse(401, { error: "unauthenticated" }));
    const err = await apiFetch("/api/me").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: "unauthenticated", status: 401 });
    expect(onAuthFailure).toHaveBeenCalledWith("unauthenticated");
  });

  it("treats any 401 as signed out, whatever the body", async () => {
    const { apiFetch, fetchImpl, onAuthFailure } = setup();
    fetchImpl.mockResolvedValue(new Response("<html>nope</html>", { status: 401 }));
    await expect(apiFetch("/api/me")).rejects.toMatchObject({ kind: "unauthenticated" });
    expect(onAuthFailure).toHaveBeenCalledWith("unauthenticated");
  });

  it("maps 403 {error: deactivated} to sign-out with the deactivated message", async () => {
    const { apiFetch, fetchImpl, onAuthFailure } = setup();
    fetchImpl.mockResolvedValue(jsonResponse(403, { error: "deactivated", message: "server text" }));
    await expect(apiFetch("/api/me")).rejects.toMatchObject({
      kind: "deactivated",
      status: 403,
      message: DEACTIVATED_MESSAGE,
    });
    expect(onAuthFailure).toHaveBeenCalledWith("deactivated");
    expect(DEACTIVATED_MESSAGE).toBe("This account has been deactivated. Contact your administrator.");
  });

  it("keeps other 403s as 'forbidden' without signing out", async () => {
    const { apiFetch, fetchImpl, onAuthFailure } = setup();
    fetchImpl.mockResolvedValue(jsonResponse(403, { error: "forbidden" }));
    await expect(apiFetch("/api/x")).rejects.toMatchObject({ kind: "forbidden" });
    fetchImpl.mockResolvedValue(new Response("not json", { status: 403 }));
    await expect(apiFetch("/api/x")).rejects.toMatchObject({ kind: "forbidden" });
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it("maps other HTTP errors to 'http' with the status", async () => {
    const { apiFetch, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(jsonResponse(500, { error: "server_error" }));
    await expect(apiFetch("/api/x")).rejects.toMatchObject({ kind: "http", status: 500 });
  });

  it("maps a network failure to 'network'", async () => {
    const { apiFetch, fetchImpl } = setup();
    fetchImpl.mockRejectedValue(new TypeError("Network request failed"));
    await expect(apiFetch("/api/x")).rejects.toMatchObject({ kind: "network" });
  });

  it("times out", async () => {
    jest.useFakeTimers();
    try {
      const { apiFetch, fetchImpl } = setup({ timeoutMs: 1000 });
      fetchImpl.mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      );
      const pending = apiFetch("/api/slow").catch((e) => e);
      await jest.advanceTimersByTimeAsync(1001);
      await expect(pending).resolves.toMatchObject({ kind: "timeout" });
    } finally {
      jest.useRealTimers();
    }
  });

  it("doesn't send a request the caller has already abandoned", async () => {
    const { apiFetch, fetchImpl, onAuthFailure } = setup();
    const controller = new AbortController();
    const pending = apiFetch("/api/x", { signal: controller.signal }).catch((e) => e);
    controller.abort("left the screen");
    await expect(pending).resolves.toBe("left the screen");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it("passes a mid-flight caller abort through untouched (not as timeout/network)", async () => {
    const { apiFetch, fetchImpl } = setup();
    const abortErr = new Error("AbortError");
    fetchImpl.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(abortErr));
        }),
    );
    const controller = new AbortController();
    const pending = apiFetch("/api/x", { signal: controller.signal }).catch((e) => e);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    controller.abort();
    await expect(pending).resolves.toBe(abortErr);
  });

  it("rejects a body that isn't JSON as invalid_response", async () => {
    const { apiFetch, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(new Response("<html>gateway</html>", { status: 200 }));
    await expect(apiFetch("/api/x")).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("validates with a schema when given one", async () => {
    const { apiFetch, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(jsonResponse(200, { n: "not a number" }));
    await expect(apiFetch("/api/x", { schema: z.object({ n: z.number() }) })).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });
});

describe("GET /api/me", () => {
  it("parses the contract", async () => {
    const { apiFetch, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(jsonResponse(200, ME));
    const me = await getMe(apiFetch);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE}/api/me`);
    expect(me.user.email).toBe("jo@example.org");
    expect(me.roles).toHaveLength(2);
    expect(me.permissions).toHaveLength(2);
    expect(me.serverTime).toBe(ME.serverTime);
    expect(displayName(me)).toBe("Sample");
  });

  it("is tolerant: extra fields ignored, nullable/missing optional fields accepted", () => {
    const me = meSchema.parse({
      user: { id: "u2", email: null, extra: 1 },
      profile: null,
      roles: [{ name: "staff" }],
      // permissions + serverTime missing
      modules: ["finance"],
    });
    expect(me.profile).toBeNull();
    expect(me.roles[0]).toEqual({ name: "staff", scopeType: null, scopeId: null });
    expect(me.permissions).toEqual([]);
    expect(me.serverTime).toBeNull();
    expect(displayName(me)).toBe("there");
  });

  it("accepts an unknown permission source", () => {
    const me = meSchema.parse({
      ...ME,
      permissions: [{ key: "x", scopeType: null, scopeId: null, source: "group" }],
    });
    expect(me.permissions[0].source).toBe("group");
  });

  it.each([
    ["empty object", {}],
    ["user missing id", { ...ME, user: { email: "a@b.c" } }],
    ["roles not an array", { ...ME, roles: "staff" }],
    ["role without name", { ...ME, roles: [{ scopeType: null }] }],
  ])("rejects a malformed body (%s) as invalid_response", async (_label, body) => {
    const { apiFetch, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(jsonResponse(200, body));
    await expect(getMe(apiFetch)).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("falls back through preferred name, first name, then email", () => {
    const base = meSchema.parse(ME);
    expect(displayName({ ...base, profile: { ...base.profile!, preferredName: null } })).toBe("Sample");
    expect(displayName({ ...base, profile: null })).toBe("jo@example.org");
  });
});
