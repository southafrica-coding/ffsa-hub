/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrgSwitcherMount } from "./org-switcher-mount";
import type { MissioMe } from "./types-shim";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ pathname: "/dashboard" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
}));

const prodPastor: MissioMe = {
  orgs: [{ id: "org-missio", slug: "missio", name: "Missio" }],
  rolesByOrg: { missio: ["pastor"] },
  currentOrg: "missio",
};

const bothOrgs: MissioMe = {
  orgs: [
    { id: "org-ffsa", slug: "ffsa", name: "Fire & Fragrance SA" },
    { id: "org-missio", slug: "missio", name: "Missio Church" },
  ],
  rolesByOrg: { ffsa: ["admin"], missio: ["pastor"] },
  currentOrg: "missio",
};

function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, root };
}

describe("FFSA desktop org switcher", () => {
  const roots: Root[] = [];
  const hosts: HTMLElement[] = [];

  afterEach(() => {
    nav.pathname = "/dashboard";
    while (roots.length) act(() => roots.pop()?.unmount());
    while (hosts.length) hosts.pop()?.remove();
    document.body.innerHTML = "";
  });

  async function settle() {
    for (let i = 0; i < 8; i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  it("shows FFSA Hub and Missio for a super_admin and staff pastor", async () => {
    const loadFfsaRoles = vi.fn(async () => ["staff", "super_admin"] as const);
    const { host, root } = render(
      <OrgSwitcherMount loadMe={async () => prodPastor} loadFfsaRoles={loadFfsaRoles} />
    );
    roots.push(root);
    hosts.push(host);
    await settle();

    expect(loadFfsaRoles).toHaveBeenCalledTimes(1);
    const trigger = host.querySelector("[data-org-switcher] button") as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    act(() => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const menu = document.body.querySelector("[role=listbox]") as HTMLElement;
    expect(menu.textContent).toContain("FFSA Hub");
    expect(menu.textContent).toContain("Missio");
    const ffsa = [...menu.querySelectorAll("a")].find((link) => link.textContent?.includes("FFSA Hub"));
    const missio = [...menu.querySelectorAll("a")].find((link) => link.getAttribute("href") === "/missio");
    expect(ffsa?.getAttribute("href")).toBe("/dashboard");
    expect(missio?.textContent).toContain("Missio");
  });

  it("hides the switcher for a Missio-only pastor", async () => {
    const { host, root } = render(
      <OrgSwitcherMount loadMe={async () => prodPastor} loadFfsaRoles={async () => []} />
    );
    roots.push(root);
    hosts.push(host);
    await settle();
    expect(host.querySelector("[data-org-switcher]")).toBeNull();
  });

  it("uses an org list that already contains both organisations", async () => {
    const loadFfsaRoles = vi.fn(async () => ["super_admin"]);
    const { host, root } = render(
      <OrgSwitcherMount loadMe={async () => bothOrgs} loadFfsaRoles={loadFfsaRoles} />
    );
    roots.push(root);
    hosts.push(host);
    await settle();
    expect(loadFfsaRoles).not.toHaveBeenCalled();
    expect(host.querySelector("[data-org-switcher]")).toBeTruthy();
  });
});
