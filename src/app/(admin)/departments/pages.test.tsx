import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DepartmentAccess, DepartmentHome } from "@/lib/departments/ui-contract";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("REDIRECT"), { url });
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const loadDepartmentList = vi.hoisted(() => vi.fn());
const loadDepartmentHome = vi.hoisted(() => vi.fn());
const loadHubServices = vi.hoisted(() => vi.fn());

vi.mock("@/lib/departments/session", () => ({
  requireSignedIn: async () => ({ id: "donors-dev-member" }),
}));

vi.mock("@/lib/departments/load", () => ({
  loadDepartmentList: (...args: unknown[]) => loadDepartmentList(...args),
  loadDepartmentHome: (...args: unknown[]) => loadDepartmentHome(...args),
  loadHubServices: (...args: unknown[]) => loadHubServices(...args),
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

/** Loader payload for a donors_dev member. Detail is on the payload; the page must not recompute it. */
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

describe("department pages with loader fixtures", () => {
  beforeEach(() => {
    loadDepartmentList.mockReset();
    loadDepartmentHome.mockReset();
    loadHubServices.mockReset();
    loadHubServices.mockResolvedValue([]);
  });

  it("renders detail for a donors_dev member when the loader sets canSeeDepartmentDetail", async () => {
    const home = foldedFinanceHome();
    loadDepartmentHome.mockResolvedValue(home);

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

  it("redirects /departments/donors_dev to the slug the loader returns", async () => {
    loadDepartmentHome.mockResolvedValue(foldedFinanceHome());

    await expect(
      DepartmentPage({
        params: Promise.resolve({ slug: "donors_dev" }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toMatchObject({ url: "/departments/finances_legal" });
    expect(loadDepartmentHome).toHaveBeenCalledWith("donors_dev", "/departments/donors_dev");
  });

  it("404s the index when the loader department list is empty", async () => {
    loadDepartmentList.mockResolvedValue([]);
    await expect(DepartmentsIndexPage()).rejects.toThrow("NOT_FOUND");
  });

  it("404s a department home for that same empty list", async () => {
    loadDepartmentHome.mockRejectedValue(new Error("NOT_FOUND"));
    loadHubServices.mockResolvedValue([]);

    await expect(
      DepartmentPage({
        params: Promise.resolve({ slug: "finances_legal" }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow("NOT_FOUND");
  });
});
