/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrgSwitcher } from "./org-switcher";
import type { OrgSwitcherOrg } from "./use-org-switcher";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

const ORGS: OrgSwitcherOrg[] = [
  { id: "org-ffsa", slug: "ffsa", name: "Fire & Fragrance SA", href: "/dashboard" },
  { id: "org-missio", slug: "missio", name: "Missio Church", href: "/missio" },
];

function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return { host, root };
}

describe("OrgSwitcher", () => {
  const roots: Root[] = [];
  const hosts: HTMLElement[] = [];

  afterEach(() => {
    while (roots.length) act(() => roots.pop()?.unmount());
    while (hosts.length) hosts.pop()?.remove();
    document.body.innerHTML = "";
  });

  it("hides itself when the viewer has one org", () => {
    const { host, root } = render(
      <OrgSwitcher orgs={[ORGS[0]]} currentOrg="ffsa" />
    );
    roots.push(root);
    hosts.push(host);
    expect(host.querySelector("[data-org-switcher]")).toBeNull();
  });

  it("shows both orgs and keeps the FFSA skin until Missio is current", () => {
    const { host, root } = render(<OrgSwitcher orgs={ORGS} currentOrg="ffsa" />);
    roots.push(root);
    hosts.push(host);
    const trigger = host.querySelector("[data-org-switcher]") as HTMLElement;
    expect(trigger.getAttribute("data-skin")).toBe("ffsa");
    expect(trigger.textContent).toContain("FF");
    expect(trigger.textContent).not.toContain("Missio Church");

    act(() => {
      host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const menu = document.body.querySelector("[role=listbox]");
    expect(menu?.textContent).toContain("Fire & Fragrance SA");
    expect(menu?.textContent).toContain("FFSA Hub");
    expect(menu?.textContent).toContain("Missio Church");
    expect(menu?.textContent).toContain("Missio");
    expect(menu?.textContent).not.toMatch(/shared|giving stay/i);
    expect(menu?.querySelector("[class*=kbd]")).toBeNull();
    const missio = [...document.body.querySelectorAll("a")].find((link) => link.textContent?.includes("Missio Church"));
    expect(missio?.getAttribute("href")).toBe("/missio");
  });

  it("switches the tile and skin when Missio is the current org", () => {
    const { host, root } = render(<OrgSwitcher orgs={ORGS} currentOrg="missio" />);
    roots.push(root);
    hosts.push(host);
    const trigger = host.querySelector("[data-org-switcher]") as HTMLElement;
    expect(trigger.getAttribute("data-skin")).toBe("missio");
    expect(trigger.getAttribute("data-org")).toBe("missio");
    expect(trigger.textContent).toContain("M");
    expect(trigger.textContent).toContain("Missio Church");
  });
});
