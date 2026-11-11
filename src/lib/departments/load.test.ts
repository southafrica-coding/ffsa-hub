import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("REDIRECT"), { url });
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import { DepartmentLoadError, redirectToCanonicalDepartment, settleViewerResult } from "./load";

const detail = {
  canSeeDepartmentDetail: true,
  canSeeBudget: false,
  canEditBudget: false,
  canEditRocks: false,
  canSeePeopleEmails: false,
};

describe("viewer result mapping", () => {
  it("sends unauthenticated to the login path, including the query", () => {
    expect(() =>
      settleViewerResult({ kind: "unauthenticated" }, "/departments/x?tab=budget")
    ).toThrowError(
      expect.objectContaining({
        url: "/login?redirect=" + encodeURIComponent("/departments/x?tab=budget"),
      })
    );
  });

  it("404s forbidden and not_found", () => {
    expect(() => settleViewerResult({ kind: "forbidden" }, "/departments")).toThrow("NOT_FOUND");
    expect(() => settleViewerResult({ kind: "not_found" }, "/departments")).toThrow("NOT_FOUND");
  });

  it("throws on error so the error boundary can catch it", () => {
    expect(() => settleViewerResult({ kind: "error", error: new Error("db down") }, "/home")).toThrow(
      DepartmentLoadError
    );
  });

  it("returns ok data unchanged", () => {
    const data = [{ slug: "media" }];
    expect(settleViewerResult({ kind: "ok", data }, "/departments")).toBe(data);
  });

  it("redirects a folded slug and keeps the query", () => {
    expect(() =>
      redirectToCanonicalDepartment(
        { kind: "redirect", slug: "finances_legal" },
        "/departments/donors_dev?tab=budget"
      )
    ).toThrowError(expect.objectContaining({ url: "/departments/finances_legal?tab=budget" }));
  });

  it("does not redirect an ordinary home result", () => {
    expect(() =>
      redirectToCanonicalDepartment(
        {
          kind: "ok",
          data: {
            department: {
              slug: "finances_legal",
              name: "Finances & Legal",
              cluster: "backbone",
              parentSlug: null,
              parentName: null,
              purpose: null,
              memberCount: 1,
              active: true,
              budgetOnly: false,
              viewerMembership: "none",
              access: detail,
            },
            access: detail,
            viewerMemberships: [],
            people: null,
            okrs: null,
            rocks: null,
            budget: null,
            servicesRun: null,
            subMinistries: null,
          },
        },
        "/departments/finances_legal"
      )
    ).not.toThrow();
  });
});
