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

// Lets a test widen canAccessMissio (e.g. to ordinary members) without
// touching canSeeMissioCare, so Care must follow the API's role list alone.
const gate = vi.hoisted(() => ({ widen: false }));

vi.mock("./access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./access")>();
  return {
    ...actual,
    canAccessMissio: (me: MissioMe) => (gate.widen && me.currentOrg === "missio") || actual.canAccessMissio(me),
  };
});

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

const noRoles = async () => [] as const;

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
    gate.widen = false;
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

  it("applies the Missio skin for a pastor", async () => {
    const { host, root } = render(
      <MissioFrame client={client(async () => pastor)} loadFfsaRoles={noRoles}>
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
    expect(host.textContent).toContain("Volunteers");
    expect(host.textContent).toContain("House churches");
    expect(host.textContent).toContain("Teams");
    const houseLink = host.querySelector("a[href='/missio/house-churches']") as HTMLAnchorElement;
    expect(houseLink).toBeTruthy();
    expect(houseLink.textContent).toContain("House churches");
    expect(houseLink.textContent?.toLowerCase()).not.toContain("soon");
    expect(houseLink.getAttribute("data-testid")).toBe("missio-nav-house-churches");
    const followLink = host.querySelector("[data-testid=missio-nav-follow-up]") as HTMLAnchorElement;
    expect(followLink.getAttribute("href")).toBe("/missio/follow-up");
    expect(followLink.textContent).toContain("Follow-up");
    expect(followLink.textContent?.toLowerCase()).not.toContain("soon");
    const soon = [...host.querySelectorAll("span")].filter((el) => el.textContent === "Soon");
    expect(soon).toHaveLength(1);
    expect(soon[0]?.parentElement?.textContent).toContain("Teams");
  });

  it("marks House churches current and names it in the crumb", async () => {
    nav.pathname = "/missio/house-churches/review";
    const { host, root } = render(
      <MissioFrame client={client(async () => pastor)} loadFfsaRoles={noRoles}>
        <p>Houses live here</p>
      </MissioFrame>
    );
    roots.push(root);
    hosts.push(host);
    await settle();
    const link = host.querySelector("a[href='/missio/house-churches']") as HTMLAnchorElement;
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.textContent?.toLowerCase()).not.toContain("soon");
    expect(host.textContent).toContain("Missio Church / House churches");
    expect(host.textContent).not.toContain("Missio Church / Home");
    const teams = [...host.querySelectorAll("span")].filter((el) => el.textContent === "Soon");
    expect(teams).toHaveLength(1);
    expect(teams[0]?.parentElement?.textContent).toContain("Teams");
  });

  it("names a house and Follow-up in the crumb", async () => {
    for (const [pathname, section] of [
      ["/missio/house-churches/house-2", "House churches"],
      ["/missio/follow-up", "Follow-up"],
      ["/missio/follow-up/r_1", "Follow-up"],
    ] as const) {
      nav.pathname = pathname;
      const { host, root } = render(
        <MissioFrame client={client(async () => pastor)} loadFfsaRoles={noRoles}>
          <p>Section</p>
        </MissioFrame>
      );
      roots.push(root);
      hosts.push(host);
      await settle();
      expect(host.textContent).toContain(`Missio Church / ${section}`);
    }
  });

  it("marks Follow-up current and names it in the crumb", async () => {
    nav.pathname = "/missio/follow-up";
    const { host, root } = render(
      <MissioFrame client={client(async () => pastor)} loadFfsaRoles={noRoles}>
        <p>Follow-up lives here</p>
      </MissioFrame>
    );
    roots.push(root);
    hosts.push(host);
    await settle();
    const link = host.querySelector("[data-testid=missio-nav-follow-up]") as HTMLAnchorElement;
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.textContent?.toLowerCase()).not.toContain("soon");
    expect(host.textContent).toContain("Missio Church / Follow-up");
  });

  it("gives a pastor a phone tab bar and marks the current section", async () => {
    nav.pathname = "/missio/house-churches/house-2";
    const { host, root } = render(
      <MissioFrame client={client(async () => pastor)} loadFfsaRoles={noRoles}>
        <p>House lives here</p>
      </MissioFrame>
    );
    roots.push(root);
    hosts.push(host);
    await settle();
    const bar = host.querySelector("[data-testid=missio-tab-bar]") as HTMLElement;
    expect(bar.getAttribute("aria-label")).toBe("Missio sections");
    const tabs = [...bar.querySelectorAll("a")];
    expect(tabs.map((tab) => tab.getAttribute("href"))).toEqual([
      "/missio",
      "/missio/people",
      "/missio/house-churches",
      "/missio/follow-up",
      "/missio/volunteers",
    ]);
    const current = tabs.filter((tab) => tab.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute("data-testid")).toBe("missio-tab-house-churches");
    expect(bar.textContent?.toLowerCase()).not.toContain("soon");
  });

  it("gives a house leader Care, in the menu and the phone tab bar", async () => {
    nav.pathname = "/missio/care";
    const leader: MissioMe = {
      orgs: [{ id: "org-missio", slug: "missio", name: "Missio Church" }],
      rolesByOrg: { missio: ["house_church_leader"] },
      currentOrg: "missio",
    };
    const { host, root } = render(
      <MissioFrame client={client(async () => leader)} loadFfsaRoles={noRoles}>
        <p>Care lives here</p>
      </MissioFrame>
    );
    roots.push(root);
    hosts.push(host);
    await settle();
    expect(host.querySelector("[data-testid=missio-nav-care]")).not.toBeNull();
    const tabs = [...host.querySelectorAll("[data-testid=missio-tab-bar] a")];
    expect(tabs.map((tab) => tab.getAttribute("href"))).toEqual(["/missio", "/missio/house-churches", "/missio/care"]);
    expect(host.querySelector("[data-testid=missio-tab-care]")?.getAttribute("aria-current")).toBe("page");
  });

  it("gives a coach Care, in the menu and the phone tab bar", async () => {
    const coach: MissioMe = {
      orgs: [{ id: "org-missio", slug: "missio", name: "Missio Church" }],
      rolesByOrg: { missio: ["coach"] },
      currentOrg: "missio",
    };
    const { host, root } = render(
      <MissioFrame client={client(async () => coach)} loadFfsaRoles={noRoles}>
        <p>Home lives here</p>
      </MissioFrame>
    );
    roots.push(root);
    hosts.push(host);
    await settle();
    expect(host.querySelector("[data-testid=missio-nav-care]")?.getAttribute("href")).toBe("/missio/care");
    const tabs = [...host.querySelectorAll("[data-testid=missio-tab-bar] a")];
    expect(tabs.map((tab) => tab.getAttribute("href"))).toEqual(["/missio", "/missio/house-churches", "/missio/care"]);
    expect(host.querySelector("[data-testid=missio-tab-care]")).not.toBeNull();
  });

  it("gives a pastor Care in the menu but leaves the pastor tab bar without it", async () => {
    const { host, root } = render(
      <MissioFrame client={client(async () => pastor)} loadFfsaRoles={noRoles}>
        <p>Home lives here</p>
      </MissioFrame>
    );
    roots.push(root);
    hosts.push(host);
    await settle();
    expect(host.querySelector("[data-testid=missio-nav-care]")?.getAttribute("href")).toBe("/missio/care");
    expect(host.querySelector("[data-testid=missio-tab-care]")).toBeNull();
    const tabs = [...host.querySelectorAll("[data-testid=missio-tab-bar] a")];
    expect(tabs.map((tab) => tab.getAttribute("href"))).not.toContain("/missio/care");
  });

  it("hides Care from a Missio viewer outside the house roles, even if they can open Missio", async () => {
    // Today canAccessMissio refuses this role. Widen it as a later change might:
    // Care must still follow GET /api/missio/care (MISSIO_HOUSE_ROLES).
    gate.widen = true;
    const member: MissioMe = {
      orgs: [{ id: "org-missio", slug: "missio", name: "Missio Church" }],
      rolesByOrg: { missio: ["team_leader"] },
      currentOrg: "missio",
    };
    const { host, root } = render(
      <MissioFrame client={client(async () => member)} loadFfsaRoles={noRoles}>
        <p>Home lives here</p>
      </MissioFrame>
    );
    roots.push(root);
    hosts.push(host);
    await settle();
    expect(host.querySelector("[data-missio-shell]")?.getAttribute("data-access")).toBe("ready");
    expect(host.querySelector("[data-testid=missio-nav-care]")).toBeNull();
    expect(host.querySelector("[data-testid=missio-tab-care]")).toBeNull();
    expect(host.querySelector("a[href='/missio/care']")).toBeNull();
    const tabs = [...host.querySelectorAll("[data-testid=missio-tab-bar] a")];
    expect(tabs.map((tab) => tab.getAttribute("href"))).toEqual(["/missio", "/missio/house-churches"]);
  });

  it("marks Volunteers, not Home, on the volunteers page", async () => {
    nav.pathname = "/missio/volunteers";
    const { host, root } = render(
      <MissioFrame client={client(async () => pastor)} loadFfsaRoles={noRoles}>
        <p>Volunteers live here</p>
      </MissioFrame>
    );
    roots.push(root);
    hosts.push(host);
    await settle();
    const on = [...host.querySelectorAll("[data-testid=missio-tab-bar] a[aria-current=page]")];
    expect(on.map((tab) => tab.getAttribute("data-testid"))).toEqual(["missio-tab-volunteers"]);
  });

  it("shows no access for an FFSA admin with no Missio role", async () => {
    const { host, root } = render(
      <MissioFrame client={client(async () => ffsaAdmin)} loadFfsaRoles={noRoles}>
        <p>People live here</p>
      </MissioFrame>
    );
    roots.push(root);
    hosts.push(host);
    await settle();
    expect(host.querySelector("[data-testid=missio-no-access]")?.textContent).toMatch(/Pastors only/);
    expect(host.querySelector("a[href='/missio/house-churches']")).toBeNull();
    expect(host.querySelector("[data-access]")?.getAttribute("data-access")).toBe("denied");
    expect(host.textContent).not.toContain("People live here");
  });

  it("shows no access when the me route returns 403", async () => {
    const { host, root } = render(
      <MissioFrame
        client={client(async () => {
          throw new MissioApiError(403, "No Missio pastor role", null, "forbidden");
        })}
        loadFfsaRoles={noRoles}
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
      <MissioFrame client={client(async () => pastor)} loadFfsaRoles={noRoles}>
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
    const drawerLink = dialog.querySelector("a[href='/missio/house-churches']");
    expect(drawerLink?.textContent).toContain("House churches");
    expect(drawerLink?.textContent?.toLowerCase()).not.toContain("soon");
    const drawerSoon = [...dialog.querySelectorAll("span")].filter((el) => el.textContent === "Soon");
    expect(drawerSoon).toHaveLength(1);
    expect(drawerSoon[0]?.parentElement?.textContent).toContain("Teams");
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
        <MissioFrame client={client(async () => pastor)} loadFfsaRoles={noRoles}>
          <p>People live here</p>
        </MissioFrame>
      );
    });
    await settle();
    expect(document.body.querySelector("[role='dialog']")).toBeNull();
  });

  it("Escape closes the org switcher first, then the phone menu", async () => {
    const { host, root } = render(
      <MissioFrame client={client(async () => pastor)} loadFfsaRoles={noRoles}>
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
    expect(css).toMatch(/\.shell \.orgBack,\s*\.drawer \.orgBack\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.shell \.orgBack,\s*\.drawer \.orgBack\s*\{[^}]*text-decoration:\s*underline/);
  });
});

/**
 * GET /api/missio/me for a pastor whose only org_staff_roles row is Missio.
 * FFSA super_admin and staff live on user_roles and are not in this payload.
 * The organisation name is the seeded "Missio", not the fixture's "Missio Church".
 */
const prodPastor: MissioMe = {
  orgs: [{ id: "org-missio", slug: "missio", name: "Missio" }],
  rolesByOrg: { missio: ["pastor"] },
  currentOrg: "missio",
};

describe("org switcher for a real FFSA and Missio user", () => {
  const roots: Root[] = [];
  const hosts: HTMLElement[] = [];

  afterEach(() => {
    nav.pathname = "/missio";
    gate.widen = false;
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

  function mount(node: ReactNode) {
    const { host, root } = render(node);
    roots.push(root);
    hosts.push(host);
    return host;
  }

  it("gives a super_admin and staff pastor a working switcher for FFSA Hub and Missio", async () => {
    const host = mount(
      <MissioFrame client={client(async () => prodPastor)} loadFfsaRoles={async () => ["staff", "super_admin"]}>
        <p>People live here</p>
      </MissioFrame>
    );
    await settle();

    const aside = host.querySelector("aside") as HTMLElement;
    const trigger = aside.querySelector("[data-org-switcher] button") as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.querySelector("svg")).toBeTruthy();
    expect(trigger.textContent).toContain("Missio");
    expect(trigger.textContent).not.toContain("Missio Church");
    expect(aside.textContent).toContain("Pastor");

    act(() => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const menu = document.body.querySelector("[role=listbox]") as HTMLElement;
    expect(menu.textContent).toContain("FFSA Hub");
    expect(menu.textContent).toContain("Fire & Fragrance South Africa");
    expect(menu.textContent).toContain("Missio");
    const ffsa = [...menu.querySelectorAll("a")].find((link) => link.textContent?.includes("FFSA Hub"));
    const current = [...menu.querySelectorAll("a")].find((link) => link.getAttribute("aria-selected") === "true");
    expect(ffsa?.getAttribute("href")).toBe("/dashboard");
    expect(current?.textContent).toContain("Missio");
    expect(current?.getAttribute("href")).toBe("/missio");

    const openMenu = host.querySelector("button[aria-label='Open menu']") as HTMLButtonElement;
    act(() => {
      openMenu.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const dialog = document.body.querySelector("[role=dialog]") as HTMLElement;
    const drawerTrigger = dialog.querySelector("[data-org-switcher] button") as HTMLButtonElement;
    expect(drawerTrigger.querySelector("svg")).toBeTruthy();
    expect(drawerTrigger.textContent).toContain("Missio");
    act(() => {
      drawerTrigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const drawerMenu = [...document.body.querySelectorAll("[role=listbox]")].at(-1);
    expect(drawerMenu?.textContent).toContain("FFSA Hub");
    expect(drawerMenu?.querySelector("a[href='/dashboard']")).toBeTruthy();
  });

  it("keeps a Missio-only pastor on a static label", async () => {
    const host = mount(
      <MissioFrame client={client(async () => prodPastor)} loadFfsaRoles={async () => []}>
        <p>People live here</p>
      </MissioFrame>
    );
    await settle();

    const aside = host.querySelector("aside") as HTMLElement;
    const label = aside.querySelector("[data-org-header=static]") as HTMLElement;
    expect(label.textContent).toContain("Missio");
    expect(label.querySelector("button")).toBeNull();
    expect(aside.querySelector("[data-org-switcher]")).toBeNull();
    expect(host.textContent).not.toContain("Back to FFSA Hub");
    expect(aside.textContent).toContain("Pastor");

    const openMenu = host.querySelector("button[aria-label='Open menu']") as HTMLButtonElement;
    act(() => {
      openMenu.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const dialog = document.body.querySelector("[role=dialog]") as HTMLElement;
    expect(dialog.querySelector("[data-org-switcher]")).toBeNull();
    expect(dialog.querySelector("[data-org-header=static]")?.textContent).toContain("Missio");
    expect(dialog.textContent).not.toContain("Back to FFSA Hub");
  });

  it("links back to the hub when the org list is empty", async () => {
    const empty: MissioMe = {
      orgs: [],
      rolesByOrg: { missio: ["pastor"] },
      currentOrg: "missio",
    };
    const host = mount(
      <MissioFrame client={client(async () => empty)} loadFfsaRoles={async () => ["super_admin"]}>
        <p>People live here</p>
      </MissioFrame>
    );
    await settle();

    const link = host.querySelector("[data-org-header=back]") as HTMLAnchorElement;
    expect(link.textContent).toBe("Back to FFSA Hub");
    expect(link.getAttribute("href")).toBe("/dashboard");
    expect(host.querySelector("[data-org-switcher]")).toBeNull();
    expect(host.querySelector("[data-org-header=static]")).toBeNull();
  });

  it("links back to the hub when the org list fails to load", async () => {
    const host = mount(
      <MissioFrame
        client={client(async () => {
          throw new Error("membership lookup failed");
        })}
        loadFfsaRoles={noRoles}
      >
        <p>People live here</p>
      </MissioFrame>
    );
    await settle();

    const link = host.querySelector("[data-org-header=back]") as HTMLAnchorElement;
    expect(link.textContent).toBe("Back to FFSA Hub");
    expect(link.getAttribute("href")).toBe("/dashboard");
    expect(host.querySelector("[data-org-switcher]")).toBeNull();
    expect(host.textContent).toMatch(/didn.t load/);
    expect(host.textContent).not.toContain("People live here");
  });

  it("gives a student who is also a pastor no FFSA option", async () => {
    const host = mount(
      <MissioFrame client={client(async () => prodPastor)} loadFfsaRoles={async () => ["student"]}>
        <p>People live here</p>
      </MissioFrame>
    );
    await settle();

    const aside = host.querySelector("aside") as HTMLElement;
    expect(aside.querySelector("[data-org-switcher]")).toBeNull();
    expect(aside.querySelector("[data-org-header=static]")?.textContent).toContain("Missio");
    expect(host.textContent).not.toContain("FFSA Hub");
    expect(host.textContent).not.toContain("Back to FFSA Hub");
  });

  it("reads membership and staff roles in parallel", async () => {
    let meStarted = false;
    let rolesStarted = false;
    let resolveMe: (me: MissioMe) => void = () => {};
    let resolveRoles: (roles: readonly string[]) => void = () => {};
    const host = mount(
      <MissioFrame
        client={client(
          () =>
            new Promise((resolve) => {
              meStarted = true;
              resolveMe = resolve;
            }),
        )}
        loadFfsaRoles={
          () =>
            new Promise((resolve) => {
              rolesStarted = true;
              resolveRoles = resolve;
            })
        }
      >
        <p>People live here</p>
      </MissioFrame>
    );
    await settle();
    expect(meStarted).toBe(true);
    expect(rolesStarted).toBe(true);
    expect(host.querySelector("[data-access]")?.getAttribute("data-access")).toBe("loading");

    await act(async () => {
      resolveMe(prodPastor);
      resolveRoles(["staff"]);
    });
    await settle();
    expect(host.querySelector("aside [data-org-switcher]")).toBeTruthy();
    expect(host.textContent).toContain("People live here");
  });

  it("shows the switcher after a failed staff-role read succeeds on Try again", async () => {
    let reads = 0;
    const host = mount(
      <MissioFrame
        client={client(async () => {
          reads += 1;
          if (reads === 1) throw new Error("membership lookup failed");
          return prodPastor;
        })}
        loadFfsaRoles={async () => (reads === 1 ? null : ["staff", "super_admin"])}
      >
        <p>People live here</p>
      </MissioFrame>
    );
    await settle();
    expect(host.querySelector("[data-org-header=back]")?.textContent).toBe("Back to FFSA Hub");
    expect(host.querySelector("[data-org-switcher]")).toBeNull();

    const retry = [...host.querySelectorAll("button")].find((button) => button.textContent === "Try again");
    act(() => {
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    const trigger = host.querySelector("aside [data-org-switcher] button") as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    act(() => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const menu = document.body.querySelector("[role=listbox]");
    expect(menu?.textContent).toContain("FFSA Hub");
    expect(menu?.querySelector("a[href='/dashboard']")).toBeTruthy();
    expect(host.querySelector("[data-org-header=back]")).toBeNull();
  });

  it("links back to the hub when platform roles fail and the org list is only Missio", async () => {
    const host = mount(
      <MissioFrame client={client(async () => prodPastor)} loadFfsaRoles={async () => null}>
        <p>People live here</p>
      </MissioFrame>
    );
    await settle();

    const link = host.querySelector("aside [data-org-header=back]") as HTMLAnchorElement;
    expect(link.textContent).toBe("Back to FFSA Hub");
    expect(link.getAttribute("href")).toBe("/dashboard");
    expect(host.querySelector("[data-org-switcher]")).toBeNull();
    expect(host.querySelector("[data-org-header=static]")).toBeNull();
  });
});
