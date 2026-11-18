/** @vitest-environment happy-dom */
import { readFileSync } from "node:fs";
import path from "node:path";
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

const nav = vi.hoisted(() => ({ pathname: "/missio" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
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
    nav.pathname = "/missio";
    while (roots.length) act(() => roots.pop()?.unmount());
    while (hosts.length) hosts.pop()?.remove();
    document.body.innerHTML = "";
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

  it("opens the phone menu and closes it from Escape, the overlay, and a route change", async () => {
    const { host, root } = render(
      <MissioFrame client={client(async () => pastor)}>
        <p>People live here</p>
      </MissioFrame>
    );
    roots.push(root);
    hosts.push(host);
    await settle();

    const openMenu = host.querySelector("button[aria-label='Open menu']") as HTMLButtonElement;
    expect(openMenu.getAttribute("aria-expanded")).toBe("false");
    act(() => {
      openMenu.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.body.querySelector("[role='dialog']") as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain("House churches");
    expect(openMenu.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.getAttribute("data-scroll-locked")).toBe("1");
    expect(document.activeElement === dialog || dialog.contains(document.activeElement)).toBe(true);

    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.body.querySelector("[role='dialog']")).toBeNull();
    expect(openMenu.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(openMenu);

    act(() => {
      openMenu.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const overlay = document.body.querySelector("[data-slot='sheet-overlay']") as HTMLElement;
    await act(async () => {
      overlay.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.body.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement).toBe(openMenu);

    act(() => {
      openMenu.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.querySelector("[role='dialog']")).toBeTruthy();
    nav.pathname = "/missio/people";
    act(() => {
      root.render(
        <MissioFrame client={client(async () => pastor)}>
          <p>People live here</p>
        </MissioFrame>
      );
    });
    await settle();
    expect(document.body.querySelector("[role='dialog']")).toBeNull();
  });

  it("Escape closes the org switcher first, then the phone menu", async () => {
    const { host, root } = render(
      <MissioFrame client={client(async () => pastor)}>
        <p>People live here</p>
      </MissioFrame>
    );
    roots.push(root);
    hosts.push(host);
    await settle();

    const openMenu = host.querySelector("button[aria-label='Open menu']") as HTMLButtonElement;
    act(() => {
      openMenu.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const dialog = document.body.querySelector("[role='dialog']") as HTMLElement;
    const trigger = dialog.querySelector("button[aria-haspopup='listbox']") as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.querySelector("[role='listbox']")).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(document.body.querySelector("[role='dialog']")).toBe(dialog);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.querySelector("[role='listbox']")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.body.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement).toBe(openMenu);
  });
});

describe("Missio mobile layout rules", () => {
  it("keeps the in-flow sidebar off phones and stacks the home cards", () => {
    const css = readFileSync(path.join(process.cwd(), "src/components/missio/shell.module.css"), "utf8");
    const mobile = css.slice(css.lastIndexOf("@media (max-width: 767px)"));
    expect(mobile).toMatch(/\.sideSlot\s*\{[^}]*display:\s*none/);
    expect(mobile).toMatch(/\.grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(mobile).toMatch(/\.toolbar\s*\{[^}]*flex-direction:\s*column/);
    expect(mobile).toMatch(/\.peopleCards\s*\{[^}]*display:\s*flex/);
    expect(mobile).toMatch(/\.table\s*\{[^}]*display:\s*none/);
    expect(mobile).toMatch(/\.crumb\s*\{[^}]*text-overflow:\s*ellipsis/);
    expect(css).toMatch(/\.menuButton,\s*\.topOrg\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/\.sideDrawer\s*\{[^}]*padding:\s*10px 8px 8px/);
    expect(css).toMatch(/padding-bottom:\s*max\(8px,\s*env\(safe-area-inset-bottom\)\)/);
  });
});
