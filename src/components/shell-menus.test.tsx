import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

import { AdminSidebar } from "./admin-sidebar";
import { MobileTabBar } from "./mobile-tab-bar";

function markup(node: ReactNode) {
  return renderToStaticMarkup(node);
}

describe("shell menus", () => {
  it("renders the portal sidebar as School, Finance, Prayer and Me", () => {
    const html = markup(
      <AdminSidebar userRoles={["staff"]} variant="portal" departments={[{ id: "media", label: "Media", href: "/departments/media" }]} />
    );
    expect(html).toContain('href="/my-schools"');
    expect(html).toContain(">School<");
    expect(html).toContain('href="/my-finance"');
    expect(html).toContain(">Finance<");
    expect(html).toContain('href="/prayer-room"');
    expect(html).toContain(">Prayer<");
    expect(html).toContain('href="/profile"');
    expect(html).toContain(">Me<");
    expect(html).toContain('href="/home"');
    expect(html).not.toContain("Work tools");
    expect(html).not.toContain("My departments");
    expect(html).not.toContain('href="/finance"');
    expect(html).not.toContain("Dashboard");
  });

  it("renders staff Home, Dashboard and Finance for someone who can open finance", () => {
    const html = markup(<AdminSidebar userRoles={["super_admin"]} />);
    expect(html).toContain('href="/home"');
    expect(html).toContain(">Home<");
    expect(html).toContain("Work tools");
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain(">Dashboard<");
    expect(html).toContain('href="/finance"');
    expect(html).toContain(">Finance<");
    expect(html).not.toContain('href="/my-finance"');
    expect(html).not.toContain("My finance");
  });

  it("keeps the phone labels on the same hrefs", () => {
    const staff = markup(<MobileTabBar />);
    expect(staff).toContain('href="/home"');
    expect(staff).toContain(">Home<");
    expect(staff).not.toContain(">Departments<");
    expect(staff).not.toContain('href="/finance"');

    const portal = markup(<MobileTabBar variant="portal" />);
    expect(portal).toContain('href="/my-schools"');
    expect(portal).toContain(">School<");
    expect(portal).toContain('href="/my-finance"');
    expect(portal).toContain(">Finance<");
    expect(portal).toContain('href="/prayer-room"');
    expect(portal).toContain(">Prayer<");
    expect(portal).toContain('href="/profile"');
    expect(portal).not.toContain('href="/finance"');
    expect(portal).not.toContain('href="/home"');
  });
});

describe("removed portal nav", () => {
  it("leaves no portal-nav module and no dangling import", () => {
    const root = path.resolve(__dirname, "../..");
    const file = path.join(root, "src/components/portal-nav.tsx");
    expect(() => statSync(file)).toThrow();
    const offenders: string[] = [];
    function walk(dir: string) {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next") continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name) || name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
        const text = readFileSync(full, "utf8");
        if (text.includes("portal-nav") || text.includes("PortalNav")) offenders.push(path.relative(root, full));
      }
    }
    walk(path.join(root, "src"));
    expect(offenders).toEqual([]);
  });
});
