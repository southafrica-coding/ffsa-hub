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
  },
  {
    id: "p-jhb",
    contactId: "c2",
    name: "Lerato Dlamini",
    campus: "jhb",
    status: "visitor",
    joinedAt: null,
    currentStage: null,
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
    expect(host.textContent).toContain("Missio JHB");
    expect(host.textContent).toContain("—");
    expect(host.textContent).not.toMatch(/Delete/);
    const campusSelect = host.querySelector("[aria-label=Campus]") as HTMLSelectElement;
    const statusSelect = host.querySelector("[aria-label=Status]") as HTMLSelectElement;
    expect(host.querySelector("#missio-campus-label")?.textContent).toBe("Campus");
    expect(host.querySelector("#missio-status-label")?.textContent).toBe("Status");
    expect(campusSelect.getAttribute("aria-labelledby")).toBe("missio-campus-label");
    expect(statusSelect.getAttribute("aria-labelledby")).toBe("missio-status-label");
    expect(campusSelect.selectedOptions[0]?.text).toBe("All campuses");
    expect(statusSelect.selectedOptions[0]?.text).toBe("All statuses");

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

  it("hides an empty stage, drops a line with no stage and no date, and names each Edit button", async () => {
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

    const neither = card("Lerato Dlamini");
    expect(neither?.querySelector("[class*=joined]")).toBeNull();
    expect(neither?.textContent).not.toContain("—");

    const dateOnly = card("Hugo Steyn");
    const joined = dateOnly?.querySelector("[class*=joined]");
    expect(joined?.textContent).toBe("2 Jan 2020");
    expect(joined?.className).not.toMatch(/campusMain/);
    expect(dateOnly?.textContent).not.toContain("—");

    const neitherCells = row("Lerato Dlamini")?.querySelectorAll("td");
    expect(neitherCells?.[3]?.textContent).toBe("");
    const dateOnlyCells = row("Hugo Steyn")?.querySelectorAll("td");
    expect(dateOnlyCells?.[3]?.textContent).toBe("");
    expect(dateOnlyCells?.[4]?.textContent).toBe("2 Jan 2020");

    for (const name of ["Mina Osei", "Lerato Dlamini", "Hugo Steyn"]) {
      expect(host.querySelectorAll(`button[aria-label='Edit ${name}']`)).toHaveLength(2);
    }
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
    const edit = [...host.querySelectorAll("button")].find((button) => button.textContent === "Edit");
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
    const edit = [...host.querySelectorAll("button")].find((button) => button.textContent === "Edit");
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
    expect(first.host.querySelector("[data-state=empty]")?.textContent).toMatch(/No Missio people yet/);

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
