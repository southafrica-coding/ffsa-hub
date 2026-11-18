import { afterEach, describe, expect, it } from "vitest";
import { clearFfsaRoleCache, loadFfsaRoleNames, readFfsaRoleNames } from "./ffsa-roles";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("FFSA platform roles", () => {
  afterEach(() => {
    clearFfsaRoleCache();
  });

  it("reads role names from the GET /api/me shape", async () => {
    const names = await readFfsaRoleNames(async () =>
      jsonResponse({
        roles: [
          { name: "staff", scopeType: null, scopeId: null },
          { name: "super_admin", scopeType: null, scopeId: null },
        ],
      }),
    );
    expect(names).toEqual(["staff", "super_admin"]);
  });

  it("returns null when the profile read fails", async () => {
    expect(await readFfsaRoleNames(async () => jsonResponse({ error: "server_error" }, 500))).toBeNull();
    expect(await readFfsaRoleNames(async () => { throw new Error("offline"); })).toBeNull();
  });

  it("caches one read until the cache is cleared", async () => {
    let calls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      return jsonResponse({ roles: [{ name: "staff", scopeType: null, scopeId: null }] });
    }) as typeof fetch;
    try {
      await expect(loadFfsaRoleNames()).resolves.toEqual(["staff"]);
      await expect(loadFfsaRoleNames()).resolves.toEqual(["staff"]);
      expect(calls).toBe(1);
      clearFfsaRoleCache();
      await expect(loadFfsaRoleNames()).resolves.toEqual(["staff"]);
      expect(calls).toBe(2);
    } finally {
      globalThis.fetch = original;
    }
  });
});
