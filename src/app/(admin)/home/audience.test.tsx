import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STAFF_LANGUAGE } from "@/lib/departments/data";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/components/profile-completion-gate", () => ({
  ProfileCompletionGate: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/assistant/assistant-mount", () => ({
  AssistantMount: () => null,
}));
vi.mock("@/lib/departments/session", () => ({
  requireSignedIn: async () => ({ id: "user" }),
}));
vi.mock("@/lib/departments/load", () => ({
  sessionClient: async () => ({ kind: "session" }),
  settleViewerResult: (result: { kind: string; data?: unknown }) => {
    if (result.kind !== "ok") throw new Error(result.kind);
    return result.data;
  },
}));

const loadHomeForViewer = vi.hoisted(() => vi.fn());
const getSidebarAccess = vi.hoisted(() => vi.fn());

vi.mock("@/lib/departments", () => ({
  loadHomeForViewer: () => loadHomeForViewer(),
}));
vi.mock("@/lib/sidebar-access", () => ({
  getSidebarAccess: () => getSidebarAccess(),
}));

import { HubShell } from "@/components/hub-shell";
import { PORTAL_HOME_CONTEXT } from "./home-context";
import HomePage from "./page";

const home = {
  departments: [],
  services: [],
  rocksDue: [],
  okrCheckInsDue: [] as [],
  viewerMemberships: [],
};

function tabBar(html: string): string {
  const start = html.indexOf("data-shell-tabbar");
  const end = html.indexOf("</nav>", start);
  return html.slice(start, end);
}

async function renderHome(roles: string[], routeVariant: "staff" | "portal") {
  getSidebarAccess.mockResolvedValue({
    userRoles: roles,
    permittedModules: new Set<string>(),
    menuLoadFailed: false,
  });
  return renderToStaticMarkup(
    await HubShell({
      userRoles: roles,
      variant: routeVariant,
      children: await HomePage(),
    })
  );
}

describe("/home follows the viewer, not the route", () => {
  beforeEach(() => {
    loadHomeForViewer.mockReset();
    loadHomeForViewer.mockResolvedValue({ kind: "ok", data: home });
    getSidebarAccess.mockReset();
  });

  it("gives a portal-only viewer portal tabs and the portal heading", async () => {
    const html = await renderHome(["student", "self_service"], "staff");
    const tabs = tabBar(html);
    expect(html).toContain(PORTAL_HOME_CONTEXT);
    expect(html).not.toContain(STAFF_LANGUAGE);
    expect(tabs).toContain('href="/my-schools"');
    expect(tabs).toContain(">School<");
    expect(tabs).toContain('href="/my-finance"');
    expect(tabs).toContain(">Finance<");
    expect(tabs).toContain('href="/prayer-room"');
    expect(tabs).toContain(">Prayer<");
    expect(tabs).toContain('href="/profile"');
    expect(tabs).toContain(">Me<");
    expect(tabs).not.toContain('href="/services"');
    expect(tabs).not.toContain(">Home<");
  });

  it("gives a staff viewer staff tabs and the staff heading", async () => {
    const html = await renderHome(["staff", "student"], "portal");
    const tabs = tabBar(html);
    expect(html).toContain(STAFF_LANGUAGE);
    expect(html).not.toContain(PORTAL_HOME_CONTEXT);
    expect(tabs).toContain('href="/home"');
    expect(tabs).toContain(">Home<");
    expect(tabs).toContain('href="/services"');
    expect(tabs).toContain(">Services<");
    expect(tabs).toContain('href="/profile"');
    expect(tabs).not.toContain('href="/my-finance"');
    expect(tabs).not.toContain(">School<");
  });
});
