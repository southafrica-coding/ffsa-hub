/** @vitest-environment happy-dom */
import { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MissioClient } from "../api";
import { missioCrumbLabel } from "../crumb";
import { cleanup, render, settle } from "../house-churches/test-render";
import { MissioFrame } from "../shell";
import type { MissioMe } from "../types-shim";

// The Calendar entry in the Missio menu: pastors only, in the side nav /
// drawer, and never a sixth phone tab (board M11a keeps five).

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const nav = vi.hoisted(() => ({ pathname: "/missio/calendar" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => ({ refresh: () => {} }) }));

const roots: Parameters<typeof cleanup>[0] = [];
const hosts: HTMLElement[] = [];
afterEach(() => cleanup(roots, hosts));

const me = (role: "pastor" | "house_church_leader" | "coach"): MissioMe => ({
  orgs: [{ id: "org-missio", slug: "missio", name: "Missio" }],
  rolesByOrg: { missio: [role] },
  currentOrg: "missio",
});

const client = (viewer: MissioMe): MissioClient => ({
  getMe: async () => viewer,
  listPeople: async () => ({ rows: [], total: 0 }),
  searchContacts: async () => ({ matches: [] }),
  createPerson: async () => {
    throw new Error("unused");
  },
  updatePerson: async () => {},
});

async function frame(viewer: MissioMe) {
  const shown = render(
    <MissioFrame client={client(viewer)} loadFfsaRoles={async () => []}>
      <p>page</p>
    </MissioFrame>
  );
  roots.push(shown.root);
  hosts.push(shown.host);
  await settle();
  await settle();
  return shown.host;
}

describe("Calendar in the Missio menu", () => {
  it("is in the pastor's side nav after Sundays, lit on the calendar page", async () => {
    const host = await frame(me("pastor"));
    const link = host.querySelector("[data-testid=missio-nav-calendar]") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/missio/calendar");
    expect(link.getAttribute("aria-current")).toBe("page");
    const keys = [...host.querySelectorAll("nav[aria-label=Missio] a")].map((a) => a.getAttribute("data-testid"));
    expect(keys.indexOf("missio-nav-calendar")).toBe(keys.indexOf("missio-nav-sundays") + 1);
  });

  it("leaves the five pastor phone tabs and the Soon items alone", async () => {
    const host = await frame(me("pastor"));
    const tabs = [...host.querySelectorAll("[data-testid=missio-tab-bar] a")].map((a) => a.textContent);
    expect(tabs).toEqual(["Home", "People", "Houses", "Sundays", "Follow-up"]);
    for (const key of ["teams", "communications", "finance"]) expect(host.querySelector(`[data-testid=missio-soon-${key}]`)).not.toBeNull();
  });

  it("is hidden from leaders and coaches", async () => {
    for (const role of ["house_church_leader", "coach"] as const) {
      const host = await frame(me(role));
      expect(host.querySelector("[data-testid=missio-nav-calendar]")).toBeNull();
      expect(host.querySelector("[data-testid=missio-tab-calendar]")).toBeNull();
    }
  });

  it("names the page in the top bar", () => {
    expect(missioCrumbLabel("/missio/calendar")).toBe("Calendar");
  });
});
