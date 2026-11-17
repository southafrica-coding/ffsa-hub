/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MissioApiError, type MissioClient } from "./api";
import { MissioFrame } from "./shell";
import type { MissioMe } from "./types-shim";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/missio",
  useRouter: () => ({ refresh: () => {} }),
}));

const pastor: MissioMe = {
  orgs: [
    { id: "org-ffsa", slug: "ffsa", name: "Fire & Fragrance SA" },
    { id: "org-missio", slug: "missio", name: "Missio Church" },
  ],
  rolesByOrg: { ffsa: ["admin"], missio: ["pastor"] },
  currentOrg: "missio",
};

const ffsaAdmin: MissioMe = {
  orgs: [{ id: "org-ffsa", slug: "ffsa", name: "Fire & Fragrance SA" }],
  rolesByOrg: { ffsa: ["admin"] },
  currentOrg: null,
};

function client(getMe: MissioClient["getMe"]): MissioClient {
  return {
    getMe,
    listPeople: async () => ({ rows: [], total: 0 }),
    searchContacts: async () => ({ matches: [] }),
    createPerson: async () => {
      throw new Error("unused");
    },
    updatePerson: async () => {},
  };
}

function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, root };
}

describe("Missio access state", () => {
  const roots: Root[] = [];
  const hosts: HTMLElement[] = [];

  afterEach(() => {
    while (roots.length) act(() => roots.pop()?.unmount());
    while (hosts.length) hosts.pop()?.remove();
  });

  async function settle() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("applies the Missio skin for a pastor", async () => {
    const { host, root } = render(
      <MissioFrame client={client(async () => pastor)}>
        <p>People live here</p>
      </MissioFrame>
    );
    roots.push(root);
    hosts.push(host);
    await settle();
    const shell = host.querySelector("[data-missio-shell]") as HTMLElement;
    expect(shell.getAttribute("data-skin")).toBe("missio");
    expect(shell.getAttribute("data-access")).toBe("ready");
    expect(shell.style.getPropertyValue("--side").trim()).toBe("#1D2520");
    expect(shell.style.getPropertyValue("--accent").trim()).toBe("#B4532E");
    expect(shell.style.getPropertyValue("--page").trim()).toBe("#F3F0E8");
    expect(shell.style.getPropertyValue("--panel").trim()).toBe("#FBF9F4");
    expect(host.textContent).toContain("People live here");
    expect(host.textContent).toContain("House churches");
    expect(host.textContent).toContain("Teams");
  });

  it("shows no access for an FFSA admin with no Missio role", async () => {
    const { host, root } = render(
      <MissioFrame client={client(async () => ffsaAdmin)}>
        <p>People live here</p>
      </MissioFrame>
    );
    roots.push(root);
    hosts.push(host);
    await settle();
    expect(host.querySelector("[data-testid=missio-no-access]")?.textContent).toMatch(/Pastors only/);
    expect(host.querySelector("[data-access]")?.getAttribute("data-access")).toBe("denied");
    expect(host.textContent).not.toContain("People live here");
  });

  it("shows no access when the me route returns 403", async () => {
    const { host, root } = render(
      <MissioFrame
        client={client(async () => {
          throw new MissioApiError(403, "No Missio pastor role", null, "forbidden");
        })}
      >
        <p>People live here</p>
      </MissioFrame>
    );
    roots.push(root);
    hosts.push(host);
    await settle();
    expect(host.querySelector("[data-testid=missio-no-access]")?.getAttribute("data-status")).toBe("403");
    expect(host.textContent).toMatch(/FFSA admin role/);
    expect(host.textContent).not.toContain("People live here");
  });
});
