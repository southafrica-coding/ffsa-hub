import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

const departmentsForShell = vi.hoisted(() => vi.fn());

vi.mock("@/lib/departments/load", () => ({
  departmentsForShell: () => departmentsForShell(),
}));
vi.mock("@/lib/viewer-cache", () => ({
  getRequestViewer: async () => ({
    supabase: { kind: "session" },
    user: { id: "user-1", email: "ada@example.com" },
    active: true,
  }),
}));
vi.mock("@/lib/sidebar-access", () => ({
  getSidebarAccess: async () => ({
    userRoles: ["staff"],
    permittedModules: new Set<string>(),
    menuLoadFailed: false,
  }),
}));
vi.mock("@/lib/user-initials", () => ({
  getShellProfile: async () => ({ initials: "TL", colorScheme: null }),
}));
vi.mock("@/services/equipment", () => ({ hasEquipmentAccess: async () => false }));
vi.mock("@/components/hub-shell", () => ({
  HubShell: ({
    departments,
    variant,
    children,
  }: {
    departments?: { id: string; label: string; href: string }[];
    variant?: string;
    children: ReactNode;
  }) => (
    <section data-variant={variant} data-departments={JSON.stringify(departments ?? [])}>
      {children}
    </section>
  ),
}));

import { AdminSidebar } from "@/components/admin-sidebar";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import AdminLayout from "./layout";
import PortalLayout from "../(portal)/layout";

describe("shell layouts", () => {
  beforeEach(() => {
    departmentsForShell.mockReset();
  });

  it("passes the viewer's departments into HubShell", async () => {
    const departments = [{ id: "media", label: "Media", href: "/departments/media" }];
    departmentsForShell.mockResolvedValue(departments);
    const admin = renderToStaticMarkup(await AdminLayout({ children: <p>Admin</p> }));
    const portal = renderToStaticMarkup(await PortalLayout({ children: <p>Portal</p> }));
    expect(admin).toContain(JSON.stringify(departments).replaceAll('"', "&quot;"));
    expect(portal).toContain("data-variant=\"portal\"");
    expect(portal).toContain(JSON.stringify(departments).replaceAll('"', "&quot;"));
  });

  it("passes an empty list when there are no departments, so the group stays hidden", async () => {
    departmentsForShell.mockResolvedValue([]);
    const markup = renderToStaticMarkup(await AdminLayout({ children: null }));
    expect(markup).toContain("data-departments=\"[]\"");

    const hidden = renderToStaticMarkup(
      <>
        <AdminSidebar userRoles={["staff"]} departments={[]} />
        <MobileTabBar showDepartments={false} />
      </>
    );
    expect(hidden).not.toContain("My departments");
    expect(hidden).not.toContain(">Departments<");

    const shown = renderToStaticMarkup(
      <>
        <AdminSidebar
          userRoles={["staff"]}
          departments={[{ id: "media", label: "Media", href: "/departments/media" }]}
        />
        <MobileTabBar showDepartments />
      </>
    );
    expect(shown).toContain("My departments");
    expect(shown).toContain("Media");
    expect(shown).toContain(">Departments<");
  });
});
