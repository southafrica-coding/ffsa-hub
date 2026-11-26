/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeopleDirectory } from "./people-directory";
import { MissioApiError, type MissioClient } from "./api";
import type { MissioPerson, MissioServingCounts, UpdateMissioPersonInput } from "./types-shim";

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

  describe("serving", () => {
    const SOUND = "00000000-0000-4000-8000-000000000001";
    const WORSHIP = "00000000-0000-4000-8000-000000000002";
    const KIDS = "00000000-0000-4000-8000-000000000003";
    const team = (id: string, name: string, leads = false) => ({ id, name, leads });
    const base = { campus: "potch" as const, status: "active" as const, joinedAt: null, currentStage: null, houses: [] };
    const servingRows: MissioPerson[] = [
      { ...base, id: "esther", contactId: "c-esther", name: "Esther Naidoo", teams: [team(KIDS, "Kids", true), team(WORSHIP, "Worship")], interestTeams: [] },
      { ...base, id: "lila", contactId: "c-lila", name: "Lila Mokoena", teams: [team(SOUND, "Sound")], interestTeams: [] },
      { ...base, id: "riley", contactId: "c-riley", name: "Riley Example", teams: [], interestTeams: [{ name: "Worship", teamId: WORSHIP }] },
      { ...base, id: "sipho", contactId: "c-sipho", name: "Sipho Dlamini", teams: [], interestTeams: [] },
    ];
    const counts: MissioServingCounts = {
      serves: 2,
      doesnt: 2,
      interested: 1,
      teams: [
        { id: KIDS, name: "Kids", count: 1 },
        { id: SOUND, name: "Sound", count: 1 },
        { id: WORSHIP, name: "Worship", count: 1 },
      ],
    };

    function servingClient(rowsIn: MissioPerson[], serving: MissioServingCounts) {
      const calls: Array<Record<string, unknown>> = [];
      const client: MissioClient = {
        getMe: async () => {
          throw new Error("unused");
        },
        async listPeople(query) {
          calls.push({ ...query });
          const kept = rowsIn.filter((person) => {
            const onTeams = person.teams ?? [];
            if (query?.serves === "yes" && onTeams.length === 0) return false;
            if (query?.serves === "no" && onTeams.length > 0) return false;
            if (query?.serves === "interested" && (person.interestTeams ?? []).length === 0) return false;
            if (query?.team && !onTeams.some((item) => item.id === query.team)) return false;
            return true;
          });
          return { rows: kept, total: kept.length, serving };
        },
        searchContacts: async () => ({ matches: [] }),
        createPerson: async () => {
          throw new Error("unused");
        },
        updatePerson: async () => {},
      };
      return { client, calls };
    }

    async function mount(client: MissioClient) {
      const { host, root } = render(<PeopleDirectory client={client} />);
      roots.push(root);
      hosts.push(host);
      await act(async () => {
        await Promise.resolve();
      });
      return host;
    }

    const card = (host: HTMLElement, name: string) =>
      [...host.querySelectorAll("[data-testid=people-cards] li")].find((item) => item.textContent?.includes(name));
    const chips = (host: HTMLElement, name: string) =>
      [...(card(host, name)?.querySelectorAll("[data-testid=person-serving] > span") ?? [])].map((chip) => ({
        text: chip.textContent,
        kind: chip.getAttribute("data-kind"),
      }));
    const funnelButton = (host: HTMLElement, label: RegExp) =>
      [...host.querySelectorAll("[data-testid=serving-funnel] button")].find((button) => label.test(button.getAttribute("aria-label") ?? "")) as
        | HTMLButtonElement
        | undefined;
    const click = async (button: Element | undefined) => {
      if (!button) throw new Error("missing button");
      await act(async () => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });
    };

    it("shows roster chips, one Leads chip, and a quiet Interested chip", async () => {
      const host = await mount(servingClient(servingRows, counts).client);
      expect(chips(host, "Esther Naidoo")).toEqual([
        { text: "Leads Kids", kind: "leads" },
        { text: "Serves Worship", kind: "serves" },
      ]);
      expect(chips(host, "Lila Mokoena")).toEqual([{ text: "Serves Sound", kind: "serves" }]);
      const interested = card(host, "Riley Example")?.querySelector("[data-kind=interested]");
      expect(interested?.textContent).toBe("Interested · Worship");
      expect(interested?.className).toMatch(/sInterest/);
      // No chip, and no "Doesn't serve" stamp, for someone on no team.
      expect(card(host, "Sipho Dlamini")?.querySelector("[data-testid=person-serving]")).toBeNull();
      expect(card(host, "Sipho Dlamini")?.textContent).not.toMatch(/serve/i);
      expect(host.querySelector("[data-testid=serving-count]")?.textContent).toBe("4 people · 2 serve");
      // Desktop: a Serves column with the same chips.
      const header = [...host.querySelectorAll("[data-testid=people-table] th")].map((th) => th.textContent);
      expect(header).toContain("Serves");
      const estherRow = [...host.querySelectorAll("[data-testid=people-table] tr")].find((tr) => tr.textContent?.includes("Esther"));
      expect(estherRow?.querySelector("[data-testid=person-serving]")?.textContent).toBe("Leads KidsServes Worship");
    });

    it("filters with All / Serves / Doesn't and team chips, and a second tap clears", async () => {
      const { client, calls } = servingClient(servingRows, counts);
      const host = await mount(client);
      expect(funnelButton(host, /^All, 4 people$/)?.getAttribute("aria-pressed")).toBe("true");
      expect(funnelButton(host, /^Serves, 2 people$/)).toBeTruthy();
      expect(funnelButton(host, /^Doesn’t serve, 2 people$/)).toBeTruthy();
      expect(funnelButton(host, /^Sound, 1 person$/)?.textContent).toBe("Sound1");

      await click(funnelButton(host, /^Doesn’t serve/));
      expect(calls.at(-1)).toMatchObject({ serves: "no", team: "", offset: 0 });
      expect(card(host, "Riley Example")).toBeTruthy();
      expect(card(host, "Esther Naidoo")).toBeUndefined();
      expect(host.querySelector("[data-testid=serving-count]")?.textContent).toBe("2 people match · Doesn’t serve");
      // Counts stay put while a serving pick is on.
      expect(funnelButton(host, /^Serves, 2 people$/)).toBeTruthy();

      await click(funnelButton(host, /^Doesn’t serve/));
      expect(calls.at(-1)).toMatchObject({ serves: "", team: "" });
      expect(card(host, "Esther Naidoo")).toBeTruthy();

      await click(funnelButton(host, /^Sound,/));
      expect(calls.at(-1)).toMatchObject({ serves: "", team: SOUND });
      expect(funnelButton(host, /^Sound,/)?.getAttribute("aria-pressed")).toBe("true");
      expect(funnelButton(host, /^Serves,/)?.getAttribute("aria-pressed")).toBe("true");
      expect(host.querySelector("[data-testid=serving-count]")?.textContent).toBe("1 person matches · Sound");
      expect(card(host, "Lila Mokoena")).toBeTruthy();
      expect(card(host, "Esther Naidoo")).toBeUndefined();

      await click(funnelButton(host, /^Sound,/));
      expect(calls.at(-1)).toMatchObject({ serves: "", team: "" });

      await click(funnelButton(host, /^Serves,/));
      expect(calls.at(-1)).toMatchObject({ serves: "yes", team: "" });
      await click(funnelButton(host, /^All,/));
      expect(calls.at(-1)).toMatchObject({ serves: "", team: "" });
    });

    it("filters to Interested, which isn't serving", async () => {
      const { client, calls } = servingClient(servingRows, counts);
      const host = await mount(client);
      const chip = funnelButton(host, /^Interested, 1 person$/);
      expect(chip?.className).toMatch(/tchipInterest/);
      await click(chip);
      expect(calls.at(-1)).toMatchObject({ serves: "interested", team: "" });
      expect([...host.querySelectorAll("[data-testid=people-cards] li a")].map((a) => a.getAttribute("href"))).toEqual([
        "/missio/people/riley",
      ]);
      expect(funnelButton(host, /^All,/)?.getAttribute("aria-pressed")).toBe("false");
    });

    it("is honest with an empty roster: zeros, no invented teams, and a pointer to Volunteers", async () => {
      const plain = servingRows.map((person) => ({ ...person, teams: [], interestTeams: [] }));
      const host = await mount(servingClient(plain, { serves: 0, doesnt: 4, interested: 0, teams: [] }).client);
      expect(funnelButton(host, /^All, 4 people$/)).toBeTruthy();
      expect(funnelButton(host, /^Serves, 0 people$/)).toBeTruthy();
      expect(funnelButton(host, /^Doesn’t serve, 4 people$/)).toBeTruthy();
      expect(host.querySelector("[aria-label='Serving teams']")).toBeNull();
      expect(funnelButton(host, /^Interested/)).toBeUndefined();
      expect(host.querySelector("[data-testid=person-serving]")).toBeNull();
      expect(host.querySelector("[data-testid=serving-count]")?.textContent).toBe("4 people · 0 serve");
      const note = host.querySelector("[data-testid=serving-empty]");
      expect(note?.textContent).toContain("No serving teams yet.");
      expect(note?.querySelector("a")?.getAttribute("href")).toBe("/missio/volunteers");
    });

    it("hides the funnel when the route couldn't read the roster", async () => {
      const client: MissioClient = {
        ...servingClient(servingRows, counts).client,
        listPeople: async () => ({ rows: servingRows.map((person) => ({ ...person, teams: undefined, interestTeams: undefined })), total: 4 }),
      };
      const host = await mount(client);
      expect(host.querySelector("[data-testid=serving-funnel]")).toBeNull();
      expect(host.querySelector("[data-testid=person-serving]")).toBeNull();
      const header = [...host.querySelectorAll("[data-testid=people-table] th")].map((th) => th.textContent);
      expect(header).not.toContain("Serves");
    });
  });

  describe("family", () => {
    const base = { campus: "potch" as const, status: "active" as const, joinedAt: null, currentStage: null };
    const house4 = [{ houseId: "h4", number: 4, name: null, role: "member" as const }];
    const kids = [
      { firstName: "Maya", age: 7 },
      { firstName: "Daniel", age: 4 },
    ];
    const familyRows: MissioPerson[] = [
      {
        ...base,
        id: "esther",
        contactId: "c-esther",
        name: "Esther Naidoo",
        houses: house4,
        teams: [{ id: "00000000-0000-4000-8000-000000000002", name: "Worship", leads: false }],
        interestTeams: [],
        family: { householdId: "hh1", spouse: { personId: "johan", firstName: "Johan", label: "Husband" }, children: kids },
      },
      {
        ...base,
        id: "johan",
        contactId: "c-johan",
        name: "Johan Naidoo",
        houses: house4,
        teams: [],
        interestTeams: [],
        family: { householdId: "hh1", spouse: { personId: "esther", firstName: "Esther", label: null }, children: kids },
      },
      { ...base, id: "lila", contactId: "c-lila", name: "Lila Mokoena", houses: [], teams: [], interestTeams: [] },
    ];
    const serving: MissioServingCounts = { serves: 1, doesnt: 2, interested: 0, teams: [{ id: "00000000-0000-4000-8000-000000000002", name: "Worship", count: 1 }] };

    async function mount(rowsIn: MissioPerson[]) {
      const client: MissioClient = {
        getMe: async () => {
          throw new Error("unused");
        },
        listPeople: async () => ({ rows: rowsIn, total: rowsIn.length, serving }),
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
      return host;
    }
    const card = (host: HTMLElement, name: string) =>
      [...host.querySelectorAll("[data-testid=people-cards] li")].find((item) => item.textContent?.includes(name));
    function cleanupAll() {
      while (roots.length) act(() => roots.pop()?.unmount());
      while (hosts.length) hosts.pop()?.remove();
    }

    it("puts a quiet family line with names and ages under the house, above the serving chips", async () => {
      const host = await mount(familyRows);
      const esther = card(host, "Esther Naidoo")!;
      const line = esther.querySelector("[data-testid=person-family]") as HTMLElement;
      expect(line.textContent).toBe("Married to Johan · Maya, 7 and Daniel, 4");
      expect(line.getAttribute("title")).toBe("Married to Johan · Maya, 7 and Daniel, 4");
      // Order: name, house meta, family line, serving chips.
      const order = [...esther.querySelectorAll("[data-testid=person-meta], [data-testid=person-family], [data-testid=person-serving]")].map((el) =>
        el.getAttribute("data-testid")
      );
      expect(order).toEqual(["person-meta", "person-family", "person-serving"]);
      expect(card(host, "Johan Naidoo")?.querySelector("[data-testid=person-family]")?.textContent).toBe("Married to Esther · Maya, 7 and Daniel, 4");
      // Names and ages, never a count.
      expect(host.textContent).not.toMatch(/\d+ (children|kids)/);
    });

    it("draws no line for someone in no household", async () => {
      const host = await mount(familyRows);
      expect(card(host, "Lila Mokoena")?.querySelector("[data-testid=person-family]")).toBeNull();
      expect(card(host, "Lila Mokoena")?.textContent).not.toMatch(/family|married/i);
    });

    it("keeps the line to one line with an ellipsis", async () => {
      const long: MissioPerson = {
        ...familyRows[0]!,
        family: {
          householdId: "hh1",
          spouse: { personId: "johan", firstName: "Johannes-Christoffel", label: null },
          children: ["Anastasia", "Bartholomew", "Constantine", "Dominique"].map((firstName, index) => ({ firstName, age: 12 - index * 3 })),
        },
      };
      const host = await mount([long]);
      const line = host.querySelector("[data-testid=person-family]") as HTMLElement;
      expect(line.textContent).toBe("Married to Johannes-Christoffel · Anastasia, 12; Bartholomew, 9; Constantine, 6 and Dominique, 3");
      // The class carries nowrap + ellipsis; the row text can shrink (min-width: 0).
      expect(line.className).toMatch(/family/);
      expect(line.closest("a")?.className).toMatch(/lrowTall/);
    });

    it("adds a Family column on desktop only when someone has a household", async () => {
      const host = await mount(familyRows);
      const header = [...host.querySelectorAll("[data-testid=people-table] th")].map((th) => th.textContent);
      expect(header).toContain("Family");
      const cells = [...host.querySelectorAll("[data-testid=person-family-cell]")].map((td) => td.textContent);
      expect(cells).toEqual(["Married to Johan · Maya, 7 and Daniel, 4", "Married to Esther · Maya, 7 and Daniel, 4", "—"]);

      cleanupAll();
      const none = await mount([familyRows[2]!]);
      const noneHeader = [...none.querySelectorAll("[data-testid=people-table] th")].map((th) => th.textContent);
      expect(noneHeader).not.toContain("Family");
    });
  });
});
