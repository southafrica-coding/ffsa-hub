import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DepartmentAccess, DepartmentHome, DepartmentSummary } from "@/lib/departments/ui-contract";

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

vi.mock("@/lib/departments/session", () => ({
  requireSignedIn: async () => ({ id: "donors-dev-member" }),
}));

import DepartmentsIndexPage from "./page";
import DepartmentPage from "./[slug]/page";

const detail: DepartmentAccess = {
  canSeeDepartmentDetail: true,
  canSeeBudget: false,
  canEditBudget: false,
  canEditRocks: false,
  canSeePeopleEmails: false,
};

/** API payload for a donors_dev member. Detail is on the payload; the page must not recompute it. */
function foldedFinanceHome(): DepartmentHome {
  return {
    department: {
      slug: "finances_legal",
      name: "Finances & Legal",
      cluster: "backbone",
      parentSlug: null,
      purpose: "Accounts for the base",
      memberCount: 2,
      active: true,
      budgetOnly: false,
      access: detail,
    },
    access: detail,
    viewerMemberships: [{ departmentSlug: "donors_dev", capacity: "member", isPointLeader: false }],
    people: [{ name: "Test Leader A", capacity: "leader", email: null }],
    okrs: null,
    rocks: [],
    budget: null,
    servicesRun: [],
    subMinistries: [],
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function routeBody(url: string, home: DepartmentHome | null, list: DepartmentSummary[]): unknown {
  if (url.endsWith("/api/departments/finances_legal")) return home;
  if (url.endsWith("/api/departments")) return list;
  if (url.endsWith("/api/services")) return [];
  throw new Error(`Unexpected ${url}`);
}

describe("department pages with API fixtures", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders detail for a donors_dev member when the API sets canSeeDepartmentDetail", async () => {
    const home = foldedFinanceHome();
    const list: DepartmentSummary[] = [home.department];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => jsonResponse(200, routeBody(String(url), home, list)))
    );

    const element = await DepartmentPage({
      params: Promise.resolve({ slug: "finances_legal" }),
      searchParams: Promise.resolve({}),
    });
    const markup = renderToStaticMarkup(element);

    expect(element.props.model.access).toEqual(detail);
    expect(element.props.model.viewerMemberships).toEqual([
      { departmentSlug: "donors_dev", capacity: "member", isPointLeader: false },
    ]);
    expect(element.props.tabs.map((tab: { key: string }) => tab.key)).toEqual([
      "overview",
      "people",
      "okrs",
      "rocks",
    ]);
    expect(markup).toContain("Accounts for the base");
    expect(markup).toContain("Test Leader A");
    expect(markup).not.toContain("Budget");
  });

  it("404s the index when the API department list is empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, [])));
    await expect(DepartmentsIndexPage()).rejects.toThrow("NOT_FOUND");
  });

  it("404s a department home for that same empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url);
        if (path.endsWith("/api/departments/finances_legal")) {
          return jsonResponse(404, { error: "Department not found" });
        }
        if (path.endsWith("/api/departments") || path.endsWith("/api/services")) {
          return jsonResponse(200, []);
        }
        throw new Error(`Unexpected ${path}`);
      })
    );

    await expect(
      DepartmentPage({
        params: Promise.resolve({ slug: "finances_legal" }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow("NOT_FOUND");
  });
});
