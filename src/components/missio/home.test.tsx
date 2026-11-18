/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MissioHome } from "./home";
import type { MissioMe } from "./types-shim";
import { MissioViewerProvider } from "./viewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const pastor: MissioMe = {
  orgs: [{ id: "org-missio", slug: "missio", name: "Missio" }],
  rolesByOrg: { missio: ["pastor"] },
  currentOrg: "missio",
};

const houseLeader: MissioMe = {
  orgs: [{ id: "org-missio", slug: "missio", name: "Missio" }],
  rolesByOrg: { missio: ["house_church_leader"] },
  currentOrg: "missio",
};

function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, root };
}

describe("Missio home cards", () => {
  const roots: Root[] = [];
  const hosts: HTMLElement[] = [];

  afterEach(() => {
    while (roots.length) act(() => roots.pop()?.unmount());
    while (hosts.length) hosts.pop()?.remove();
  });

  it("places House churches next to People for a pastor", () => {
    const { host, root } = render(
      <MissioViewerProvider me={pastor}>
        <MissioHome />
      </MissioViewerProvider>
    );
    roots.push(root);
    hosts.push(host);
    const people = host.querySelector("[data-testid=home-people]") as HTMLAnchorElement;
    const houses = host.querySelector("[data-testid=home-houses]") as HTMLAnchorElement;
    expect(people.getAttribute("href")).toBe("/missio/people");
    expect(people.textContent).toContain("People");
    expect(houses.getAttribute("href")).toBe("/missio/house-churches");
    expect(houses.textContent).toContain("House churches");
    expect(houses.textContent).toContain("membership in this church");
    expect(host.textContent).not.toMatch(/Soon|Coming soon/);
  });

  it("hides House churches without the pastor role", () => {
    const { host, root } = render(
      <MissioViewerProvider me={houseLeader}>
        <MissioHome />
      </MissioViewerProvider>
    );
    roots.push(root);
    hosts.push(host);
    expect(host.querySelector("[data-testid=home-people]")).toBeTruthy();
    expect(host.querySelector("[data-testid=home-houses]")).toBeNull();
  });
});
