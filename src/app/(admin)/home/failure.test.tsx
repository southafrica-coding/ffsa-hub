import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("REDIRECT"), { url });
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const loadHomeForViewer = vi.hoisted(() => vi.fn());
const loadServicesForViewer = vi.hoisted(() => vi.fn());
const loadDepartmentsIndexForViewer = vi.hoisted(() => vi.fn());

vi.mock("@/lib/departments", () => ({
  loadHomeForViewer: (client: unknown) => loadHomeForViewer(client),
  loadServicesForViewer: (client: unknown) => loadServicesForViewer(client),
  loadDepartmentsIndexForViewer: (client: unknown) => loadDepartmentsIndexForViewer(client),
}));
vi.mock("@/lib/departments/session", () => ({
  requireSignedIn: async () => ({ id: "user" }),
  getViewer: async () => ({ supabase: { kind: "session" }, user: { id: "user" }, active: true }),
}));
vi.mock("@/lib/viewer-cache", () => ({
  getRequestViewer: async () => ({
    supabase: { kind: "session" },
    user: { id: "user" },
    active: true,
  }),
}));
vi.mock("@/lib/sidebar-access", () => ({
  getSidebarAccess: async () => ({
    userRoles: ["staff"],
    roleNames: ["staff"],
    permittedModules: new Set<string>(),
    menuLoadFailed: false,
  }),
}));

import { departmentsForShell } from "@/lib/departments/load";
import HomePage from "./page";
import ServicesPage from "../services/page";

function department(slug: string, name: string, viewerMembership: "member" | "leader" | "none") {
  return {
    slug,
    name,
    viewerMembership,
    cluster: "inward" as const,
    budgetOnly: false,
    parentSlug: null,
    parentName: null,
    purpose: null,
    memberCount: 1,
    active: true,
    access: {
      canSeeDepartmentDetail: true,
      canSeeBudget: false,
      canEditBudget: false,
      canEditRocks: false,
      canSeePeopleEmails: false,
    },
  };
}

function homeWith(rows: ReturnType<typeof department>[]) {
  return { kind: "ok" as const, data: { departments: rows, services: [], rocksDue: [], okrCheckInsDue: [], viewerMemberships: [] } };
}

const service = {
  id: "prayer_room",
  name: "Prayer room",
  summary: "Open",
  href: "/prayer-room",
  moduleId: "prayer-room",
  owners: [],
  audience: "all_signed_in" as const,
};

describe("home and services survive a failed department read", () => {
  beforeEach(() => {
    loadHomeForViewer.mockReset();
    loadServicesForViewer.mockReset();
    loadDepartmentsIndexForViewer.mockReset();
    loadDepartmentsIndexForViewer.mockResolvedValue({ kind: "ok", data: [] });
  });

  it("renders services on /home when the home read fails", async () => {
    loadHomeForViewer.mockResolvedValue({ kind: "error", error: new Error("db down") });
    loadServicesForViewer.mockResolvedValue({ kind: "ok", data: [service] });
    const markup = renderToStaticMarkup(await HomePage());
    expect(markup).toContain("Couldn&#x27;t load departments.");
    expect(markup).toContain("Prayer room");
    expect(markup).not.toContain("db down");
  });

  it("renders the catalogue on /services when the department list fails", async () => {
    loadServicesForViewer.mockResolvedValue({ kind: "ok", data: [service] });
    loadDepartmentsIndexForViewer.mockResolvedValue({ kind: "forbidden" });
    const markup = renderToStaticMarkup(await ServicesPage());
    expect(markup).toContain("Couldn&#x27;t load departments.");
    expect(markup).toContain("Prayer room");
  });

  it("still 404s /services when the service read itself is forbidden", async () => {
    loadServicesForViewer.mockResolvedValue({ kind: "forbidden" });
    loadDepartmentsIndexForViewer.mockResolvedValue({ kind: "ok", data: [] });
    await expect(ServicesPage()).rejects.toThrow("NOT_FOUND");
  });

  it("renders /home when the home result is forbidden and drops the department part", async () => {
    loadHomeForViewer.mockResolvedValue({ kind: "forbidden" });
    loadServicesForViewer.mockResolvedValue({ kind: "ok", data: [service] });
    const markup = renderToStaticMarkup(await HomePage());
    expect(markup).toContain("Couldn&#x27;t load departments.");
    expect(markup).toContain("Prayer room");
    expect(markup).not.toContain('href="/departments/');
  });

  it("throws on /home when the services fallback errors", async () => {
    loadHomeForViewer.mockResolvedValue({ kind: "forbidden" });
    loadServicesForViewer.mockResolvedValue({ kind: "error", error: new Error("services down") });
    await expect(HomePage()).rejects.toThrow("services down");
  });

  it("lists a member under My departments", async () => {
    const row = department("media", "Media", "member");
    loadHomeForViewer.mockResolvedValue(homeWith([row]));
    loadDepartmentsIndexForViewer.mockResolvedValue({ kind: "ok", data: [row] });
    const markup = renderToStaticMarkup(await HomePage());
    expect(markup).toContain("My departments");
    expect(markup).toContain("Media");
    expect(markup).toContain('href="/departments/media"');
    expect(markup).toContain("All departments");
  });

  it("lists a leader under My departments", async () => {
    const row = department("worship", "Worship", "leader");
    loadHomeForViewer.mockResolvedValue(homeWith([row]));
    loadDepartmentsIndexForViewer.mockResolvedValue({ kind: "ok", data: [row] });
    const markup = renderToStaticMarkup(await HomePage());
    expect(markup).toContain("My departments");
    expect(markup).toContain("Worship");
    expect(markup).toContain('href="/departments/worship"');
  });

  it("does not list a department whose membership is none", async () => {
    const row = department("finance", "Finances", "none");
    loadHomeForViewer.mockResolvedValue(homeWith([row]));
    loadDepartmentsIndexForViewer.mockResolvedValue({ kind: "ok", data: [row] });
    const markup = renderToStaticMarkup(await HomePage());
    expect(markup).not.toContain("My departments");
    expect(markup).not.toContain("Finances");
    expect(markup).not.toContain('href="/departments/finance"');
    expect(markup).toContain('href="/departments"');
    expect(markup).toContain("All departments");
  });

  it("renders nothing for My departments when the index is empty too", async () => {
    loadHomeForViewer.mockResolvedValue(homeWith([]));
    loadDepartmentsIndexForViewer.mockResolvedValue({ kind: "ok", data: [] });
    const markup = renderToStaticMarkup(await HomePage());
    expect(markup).not.toContain("My departments");
    expect(markup).not.toContain("All departments");
    expect(markup).not.toContain("No department home yet");
  });

  it("keeps All departments when a membership read fails and lists no departments", async () => {
    const rows = [department("media", "Media", "none"), department("training", "Training", "none")];
    loadHomeForViewer.mockResolvedValue(homeWith(rows));
    loadDepartmentsIndexForViewer.mockResolvedValue({ kind: "ok", data: rows });
    await expect(departmentsForShell({ kind: "session" })).resolves.toEqual([]);
    const markup = renderToStaticMarkup(await HomePage());
    expect(markup).not.toContain("My departments");
    expect(markup).not.toContain("Media");
    expect(markup).not.toContain("Training");
    expect(markup).not.toContain('href="/departments/media"');
    expect(markup).toContain('href="/departments"');
    expect(markup).toContain("All departments");
  });

  it("hides the departments link when the index is empty", async () => {
    loadHomeForViewer.mockResolvedValue({
      kind: "ok",
      data: { departments: [], services: [], rocksDue: [], okrCheckInsDue: [], viewerMemberships: [] },
    });
    loadDepartmentsIndexForViewer.mockResolvedValue({ kind: "ok", data: [] });
    const markup = renderToStaticMarkup(await HomePage());
    expect(markup).not.toContain('href="/departments"');
    expect(markup).not.toContain("All departments");
  });

  it("hides the departments link when the index is forbidden or errors", async () => {
    loadHomeForViewer.mockResolvedValue({
      kind: "ok",
      data: { departments: [], services: [], rocksDue: [], okrCheckInsDue: [], viewerMemberships: [] },
    });
    for (const index of [{ kind: "forbidden" }, { kind: "error", error: new Error("db down") }] as const) {
      loadDepartmentsIndexForViewer.mockResolvedValueOnce(index);
      const markup = renderToStaticMarkup(await HomePage());
      expect(markup).not.toContain('href="/departments"');
      expect(markup).not.toContain("All departments");
    }
  });

  it("throws on /services when the services result errors", async () => {
    loadServicesForViewer.mockResolvedValue({ kind: "error", error: new Error("services down") });
    loadDepartmentsIndexForViewer.mockResolvedValue({ kind: "ok", data: [] });
    await expect(ServicesPage()).rejects.toThrow("services down");
  });
});
