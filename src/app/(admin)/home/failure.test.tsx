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

import HomePage from "./page";
import ServicesPage from "../services/page";

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

  it("throws on /services when the services result errors", async () => {
    loadServicesForViewer.mockResolvedValue({ kind: "error", error: new Error("services down") });
    loadDepartmentsIndexForViewer.mockResolvedValue({ kind: "ok", data: [] });
    await expect(ServicesPage()).rejects.toThrow("services down");
  });
});
