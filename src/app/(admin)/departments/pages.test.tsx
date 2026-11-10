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

const loadDepartmentsIndexForViewer = vi.hoisted(() => vi.fn());
const loadDepartmentHomeForViewer = vi.hoisted(() => vi.fn());
const loadServicesForViewer = vi.hoisted(() => vi.fn());
const loadHomeForViewer = vi.hoisted(() => vi.fn());
const requireSignedIn = vi.hoisted(() => vi.fn<(path?: string) => Promise<{ id: string }>>());

vi.mock("@/lib/departments", () => ({
  loadDepartmentsIndexForViewer: (client: unknown) => loadDepartmentsIndexForViewer(client),
  loadDepartmentHomeForViewer: (client: unknown, slug: string) => loadDepartmentHomeForViewer(client, slug),
  loadServicesForViewer: (client: unknown) => loadServicesForViewer(client),
  loadHomeForViewer: (client: unknown) => loadHomeForViewer(client),
}));

vi.mock("@/lib/departments/session", () => ({
  requireSignedIn: (path?: string) => requireSignedIn(path),
  getViewer: async () => ({ supabase: { kind: "session" }, user: { id: "donors-dev-member" }, active: true }),
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
      parentSlug: "training",
      parentName: "Training",
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
    loadDepartmentsIndexForViewer.mockReset();
    loadDepartmentHomeForViewer.mockReset();
    loadServicesForViewer.mockReset();
    loadHomeForViewer.mockReset();
    loadServicesForViewer.mockResolvedValue({ kind: "ok", data: [] });
    requireSignedIn.mockReset();
    requireSignedIn.mockResolvedValue({ id: "donors-dev-member" });
  });

  it("renders detail for a donors_dev member when the loader sets canSeeDepartmentDetail", async () => {
    const home = foldedFinanceHome();
    loadDepartmentHomeForViewer.mockResolvedValue({ kind: "ok", data: home });

    const element = await DepartmentPage({
      params: Promise.resolve({ slug: "finances_legal" }),
      searchParams: Promise.resolve({}),
    });
    const markup = renderToStaticMarkup(element);

    expect(loadDepartmentHomeForViewer).toHaveBeenCalledWith({ kind: "session" }, "finances_legal");
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
    expect(markup).toContain("Training");
    expect(markup).not.toContain("Budget");
  });

  it("shows nothing for a null parent name", async () => {
    const home = foldedFinanceHome();
    home.department.parentName = null;
    loadDepartmentHomeForViewer.mockResolvedValue({ kind: "ok", data: home });
    const markup = renderToStaticMarkup(
      await DepartmentPage({
        params: Promise.resolve({ slug: "finances_legal" }),
        searchParams: Promise.resolve({}),
      })
    );
    expect(markup).not.toContain("Sits under");
    expect(markup).not.toContain("training");
  });

  it("puts the tab query on the login return path", async () => {
    loadDepartmentHomeForViewer.mockResolvedValue({ kind: "ok", data: foldedFinanceHome() });
    await DepartmentPage({
      params: Promise.resolve({ slug: "finances_legal" }),
      searchParams: Promise.resolve({ tab: "budget" }),
    });
    expect(requireSignedIn).toHaveBeenCalledWith("/departments/finances_legal?tab=budget");
    expect(loadDepartmentHomeForViewer).toHaveBeenCalledWith(
      { kind: "session" },
      "finances_legal"
    );
  });

  it("redirects /departments/donors_dev to the canonical slug and keeps ?tab", async () => {
    loadDepartmentHomeForViewer.mockResolvedValue({ kind: "redirect", slug: "finances_legal" });

    await expect(
      DepartmentPage({
        params: Promise.resolve({ slug: "donors_dev" }),
        searchParams: Promise.resolve({ tab: "budget" }),
      })
    ).rejects.toMatchObject({ url: "/departments/finances_legal?tab=budget" });
    expect(loadDepartmentHomeForViewer).toHaveBeenCalledWith({ kind: "session" }, "donors_dev");
  });

  it("404s the index when the loader department list is empty", async () => {
    loadDepartmentsIndexForViewer.mockResolvedValue({ kind: "ok", data: [] });
    await expect(DepartmentsIndexPage()).rejects.toThrow("NOT_FOUND");
  });

  it("404s a department home for that same empty list", async () => {
    loadDepartmentHomeForViewer.mockResolvedValue({ kind: "not_found" });
    await expect(
      DepartmentPage({
        params: Promise.resolve({ slug: "finances_legal" }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow("NOT_FOUND");
  });
});
