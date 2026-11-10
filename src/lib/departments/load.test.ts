import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("REDIRECT"), { url });
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (key: string) => {
      if (key === "host" || key === "x-forwarded-host") return "localhost:3000";
      if (key === "x-forwarded-proto") return "http";
      return null;
    },
  }),
  cookies: async () => ({
    getAll: () => [{ name: "sb", value: "test" }],
  }),
}));

import { DepartmentApiError, loadDepartmentApi, outcomeForStatus } from "./load";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("department API outcomes", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends 401 to login", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, { error: "Not authenticated" })));
    await expect(loadDepartmentApi("/api/departments")).rejects.toMatchObject({ url: "/login" });
  });

  it("sends 403 to the not-found page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(403, { error: "Not authorized" })));
    await expect(loadDepartmentApi("/api/departments")).rejects.toThrow("NOT_FOUND");
  });

  it("sends an unopened department 404 to the not-found page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(404, { error: "Department not found" })));
    await expect(loadDepartmentApi("/api/departments/missing")).rejects.toThrow("NOT_FOUND");
  });

  it("throws on any other error and does not return a partial payload", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/api/departments")) return jsonResponse(200, [{ slug: "media" }]);
      return jsonResponse(500, { error: "Something went wrong" });
    });
    vi.stubGlobal("fetch", fetchMock);

    let rendered: unknown = null;
    await expect(
      (async () => {
        const [departments, services] = await Promise.all([
          loadDepartmentApi("/api/departments"),
          loadDepartmentApi("/api/services"),
        ]);
        rendered = { departments, services };
        return rendered;
      })()
    ).rejects.toBeInstanceOf(DepartmentApiError);
    expect(rendered).toBeNull();
    expect(outcomeForStatus(500)).toBe("error");
    expect(outcomeForStatus(0)).toBe("error");
  });

  it("throws when the request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    await expect(loadDepartmentApi("/api/me/home")).rejects.toBeInstanceOf(DepartmentApiError);
  });
});
