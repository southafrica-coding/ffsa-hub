/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeopleDirectory } from "./people-directory";
import { MissioApiError, type MissioClient } from "./api";
import type { MissioPerson, UpdateMissioPersonInput } from "./types-shim";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/missio/people",
}));

const rows: MissioPerson[] = [
  {
    id: "p-potch",
    contactId: "c1",
    name: "Mina Osei",
    campus: "potch",
    status: "active",
    joinedAt: "2024-03-12",
    currentStage: "Member",
    houses: [
      { houseId: "h1", number: 1, name: null, role: "leader" },
      { houseId: "h9", number: 9, name: "Oak Table", role: "member" },
    ],
  },
  {
    id: "p-jhb",
    contactId: "c2",
    name: "Lerato Dlamini",
    campus: "jhb",
    status: "visitor",
    joinedAt: null,
    currentStage: "contacted",
    houses: [],
  },
  {
    id: "p-old",
    contactId: "c3",
    name: "Hugo Steyn",
    campus: "potch",
    status: "inactive",
    joinedAt: "2020-01-02",
    currentStage: null,
  },
];

function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, root };
}

function directoryClient(updatePerson: MissioClient["updatePerson"] = async () => {}) {
  const calls: unknown[] = [];
  const client: MissioClient = {
    getMe: async () => {
      throw new Error("unused");
    },
    async listPeople(query) {
      calls.push(query);
      const filtered = rows.filter((person) => {
        if (query?.campus && person.campus !== query.campus) return false;
        if (query?.status && person.status !== query.status) return false;
        if (query?.q && !person.name.toLowerCase().includes(query.q.toLowerCase())) return false;
        return true;
      });
      return { rows: filtered, total: filtered.length };
    },
    searchContacts: async () => ({ matches: [] }),
    createPerson: async () => {
      throw new Error("unused");
    },
    updatePerson,
  };
  return { client, calls };
}

function setControl(host: ParentNode, label: string, value: string) {
  const el = host.querySelector(`[aria-label='${label}']`) as HTMLInputElement | HTMLSelectElement | null;
  if (!el) throw new Error(`Missing ${label}`);
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("people directory", () => {
  const roots: Root[] = [];
  const hosts: HTMLElement[] = [];

  afterEach(() => {
    while (roots.length) act(() => roots.pop()?.unmount());
    while (hosts.length) hosts.pop()?.remove();
  });

  it("filters by campus and status and searches names", async () => {
    const { client, calls } = directoryClient();
    const { host, root } = render(<PeopleDirectory client={client} />);
    roots.push(root);
    hosts.push(host);
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Mina Osei");
    expect(host.textContent).toContain("JHB");
    expect(host.textContent).not.toContain("Potch is the main church");
    expect(host.textContent).toContain("—");
    expect(host.textContent).not.toMatch(/Delete/);
    const campusSelect = host.querySelector("[aria-label=Campus]") as HTMLSelectElement;
    const statusSelect = host.querySelector("[aria-label=Status]") as HTMLSelectElement;
    expect(host.querySelector("#missio-campus-label")?.textContent).toBe("Campus");
    expect(host.querySelector("#missio-status-label")?.textContent).toBe("Status");
    expect(campusSelect.getAttribute("aria-labelledby")).toBe("missio-campus-label");
    expect(statusSelect.getAttribute("aria-labelledby")).toBe("missio-status-label");
    // Desktop chips read as the filter's name until one is picked (board M2a).
    expect(campusSelect.selectedOptions[0]?.text).toBe("Campus");
    expect(statusSelect.selectedOptions[0]?.text).toBe("Status");

    await act(async () => {
      setControl(host, "Campus", "jhb");
    });
    expect(host.textContent).toContain("Lerato Dlamini");
    expect(host.textContent).not.toContain("Mina Osei");
    expect(calls.at(-1)).toMatchObject({ campus: "jhb", limit: 50, offset: 0 });

    await act(async () => {
      setControl(host, "Status", "inactive");
      setControl(host, "Campus", "");
    });
    expect(host.textContent).toContain("Hugo Steyn");
    expect(host.textContent).not.toContain("Lerato Dlamini");

    await act(async () => {
      setControl(host, "Status", "");
      setControl(host, "Search names", "mina");
      (host.querySelector("[data-testid=people-search]") as HTMLFormElement).requestSubmit();
    });
    expect(calls.at(-1)).toMatchObject({ q: "mina" });
    expect(host.textContent).toContain("Mina Osei");
    expect(host.textContent).not.toContain("Hugo Steyn");
  });

  it("writes a two-line row on phone, a table on desktop, and names each Edit button", async () => {
    const { client } = directoryClient();
    const { host, root } = render(<PeopleDirectory client={client} />);
    roots.push(root);
    hosts.push(host);
    await act(async () => {
      await Promise.resolve();
    });

    const card = (name: string) =>
      [...host.querySelectorAll("[data-testid=people-cards] li")].find((item) => item.textContent?.includes(name));
    const row = (name: string) =>
      [...host.querySelectorAll("[data-testid=people-table] tr")].find((item) => item.textContent?.includes(name));

    // Each phone row links to the profile; the second line is house and role (board M2b).
    expect(card("Mina Osei")?.querySelector("a")?.getAttribute("href")).toBe("/missio/people/p-potch");
    expect(card("Mina Osei")?.querySelector("[data-testid=person-meta]")?.textContent).toBe("House 1 · Leader + 1 more");
    expect(card("Lerato Dlamini")?.querySelector("[data-testid=person-meta]")?.textContent).toBe("Not in a house yet · Contacted");
    expect(card("Lerato Dlamini")?.textContent).not.toContain("—");
    // Houses that couldn't be read never turn into "Not in a house yet".
    expect(card("Hugo Steyn")?.querySelector("[data-testid=person-meta]")?.textContent).toBe("Inactive · Joined 2 Jan 2020");

    // A to Z with a letter heading per first letter, and a tinted avatar on every row.
    const names = [...host.querySelectorAll("[data-testid=people-cards] li")].map((item) => item.querySelector("a")?.textContent ?? "");
    expect(names.map((name) => name.replace(/^[A-Z]{2}/, "").slice(0, 4))).toEqual(["Hugo", "Lera", "Mina"]);
    expect([...host.querySelectorAll("[data-testid=people-letter]")].map((item) => item.textContent)).toEqual(["H", "L", "M"]);
    for (const item of host.querySelectorAll("[data-testid=people-cards] li a > span:first-child")) {
      expect(item.className).toMatch(/a[1-5]/);
    }

    // Desktop: House church and Role columns.
    const minaCells = row("Mina Osei")?.querySelectorAll("td");
    expect(minaCells?.[1]?.textContent).toBe("House 1 + Oak Table");
    expect(minaCells?.[2]?.textContent).toBe("Leader");
    const leratoCells = row("Lerato Dlamini")?.querySelectorAll("td");
    expect(leratoCells?.[1]?.textContent).toBe("—");
    expect(leratoCells?.[2]?.textContent).toBe("—");
    expect(leratoCells?.[4]?.textContent).toBe("Contacted");
    expect(row("Hugo Steyn")?.querySelectorAll("td")?.[4]?.textContent).toBe("—");

    for (const name of ["Mina Osei", "Lerato Dlamini", "Hugo Steyn"]) {
      expect(host.querySelectorAll(`button[aria-label='Edit ${name}']`)).toHaveLength(1);
    }
  });

  it("filters from the phone sheet and shows the campus as a pill under the search", async () => {
    const { client, calls } = directoryClient();
    const { host, root } = render(<PeopleDirectory client={client} />);
    roots.push(root);
    hosts.push(host);
    await act(async () => {
      await Promise.resolve();
    });
    const filter = [...host.querySelectorAll("button")].find((b) => b.textContent === "Filter");
    await act(async () => {
      filter?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const sheet = document.body.querySelector("[data-testid=people-filter-sheet]") as HTMLElement;
    const jhb = [...sheet.querySelectorAll("button")].find((b) => b.textContent === "JHB");
    await act(async () => {
      jhb?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(calls.at(-1)).toMatchObject({ campus: "jhb", offset: 0 });
    expect(jhb?.getAttribute("aria-pressed")).toBe("true");
    const pills = host.querySelector("[data-testid=people-active-filters]") as HTMLElement;
    const chip = [...pills.querySelectorAll("button")].find((b) => b.textContent === "JHB");
    expect(chip?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("[role=tablist]")).toBeNull();
    await act(async () => {
      chip?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(calls.at(-1)).toMatchObject({ campus: "" });
  });

  it("marks a person inactive with PATCH and does not offer delete", async () => {
    const patches: UpdateMissioPersonInput[] = [];
    const { client } = directoryClient(async (_id, input) => {
      patches.push(input);
    });
    const { host, root } = render(<PeopleDirectory client={client} />);
    roots.push(root);
    hosts.push(host);
    await act(async () => {
      await Promise.resolve();
    });
    const edit = host.querySelector("button[aria-label='Edit Mina Osei']");
    await act(async () => {
      edit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const mark = [...document.body.querySelectorAll("button")].find((button) => button.textContent === "Mark inactive");
    await act(async () => {
      mark?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(patches).toEqual([{ status: "inactive" }]);
    expect(document.body.textContent).not.toMatch(/Delete/);
  });

  it("says when a PATCH id cannot be found and reloads the list", async () => {
    let loads = 0;
    const client: MissioClient = {
      getMe: async () => {
        throw new Error("unused");
      },
      async listPeople() {
        loads += 1;
        return { rows, total: rows.length };
      },
      searchContacts: async () => ({ matches: [] }),
      createPerson: async () => {
        throw new Error("unused");
      },
      updatePerson: async () => {
        throw new MissioApiError(404, "missing", null, "not_found");
      },
    };
    const { host, root } = render(<PeopleDirectory client={client} />);
    roots.push(root);
    hosts.push(host);
    await act(async () => {
      await Promise.resolve();
    });
    const before = loads;
    const edit = host.querySelector("button[aria-label='Edit Mina Osei']");
    await act(async () => {
      edit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const mark = [...document.body.querySelectorAll("button")].find((button) => button.textContent === "Mark inactive");
    await act(async () => {
      mark?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("This person couldn’t be found");
    expect(loads).toBeGreaterThan(before);
  });

  it("pages with the total from the route", async () => {
    const calls: unknown[] = [];
    const client: MissioClient = {
      getMe: async () => {
        throw new Error("unused");
      },
      async listPeople(query) {
        calls.push(query);
        return {
          rows: [
            {
              id: "p1",
              contactId: "c1",
              name: "Mina Osei",
              campus: "potch",
              status: "active",
              joinedAt: "2024-03-12",
              currentStage: null,
            },
          ],
          total: 80,
        };
      },
      searchContacts: async () => ({ matches: [] }),
      createPerson: async () => {
        throw new Error("unused");
      },
      updatePerson: async () => {},
    };
    const { host, root } = render(<PeopleDirectory client={client} />);
    roots.push(root);
    hosts.push(host);
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).toContain("1–50 of 80");
    await act(async () => {
      [...host.querySelectorAll("button")].find((button) => button.textContent === "Next")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    expect(calls.at(-1)).toMatchObject({ limit: 50, offset: 50 });
  });

  it("shows an empty state and an error state", async () => {
    const empty: MissioClient = {
      getMe: async () => {
        throw new Error("unused");
      },
      listPeople: async () => ({ rows: [], total: 0 }),
      searchContacts: async () => ({ matches: [] }),
      createPerson: async () => {
        throw new Error("unused");
      },
      updatePerson: async () => {},
    };
    const first = render(<PeopleDirectory client={empty} />);
    roots.push(first.root);
    hosts.push(first.host);
    await act(async () => {
      await Promise.resolve();
    });
    expect(first.host.querySelector("[data-state=empty]")?.textContent).toMatch(/No people yet/);

    const failing: MissioClient = { ...empty, listPeople: async () => { throw new Error("down"); } };
    const second = render(<PeopleDirectory client={failing} />);
    roots.push(second.root);
    hosts.push(second.host);
    await act(async () => {
      await Promise.resolve();
    });
    expect(second.host.querySelector("[data-state=error]")?.textContent).toMatch(/didn’t load/i);
  });
});
