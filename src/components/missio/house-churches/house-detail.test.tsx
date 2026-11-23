/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MissioApiError, type MissioClient } from "../api";
import type { HouseChurchesClient } from "./client";
import { HouseDetailView } from "./house-detail";
import type { HouseDetail, HouseMember } from "./types";
import { cleanup, render, setValue, settle } from "./test-render";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const leader: HouseMember = {
  contactId: "c-theo",
  displayName: "Theo Martins",
  firstName: "Theo",
  lastName: "Martins",
  orgPersonId: "person-theo",
  role: "leader",
  startedAt: "2024-03-12",
};

const coleader: HouseMember = {
  contactId: "c-lindi",
  displayName: "Lindiwe Nkosi",
  firstName: "Lindiwe",
  lastName: "Nkosi",
  role: "co_leader",
  startedAt: null,
};

const member: HouseMember = {
  contactId: "c-amina",
  displayName: "Amina Kruger",
  firstName: "Amina",
  lastName: "Kruger",
  orgPersonId: "person-amina",
  role: "member",
  startedAt: "2025-01-02",
};

const house: HouseDetail = {
  id: "house-2",
  number: 2,
  name: "Oak Table",
  campus: "potch",
  meetingDay: "Wednesday",
  location: "9 Kestrel Lane",
  memberCount: 3,
  leaders: [leader],
  coLeaders: [coleader],
  coaches: [],
  leaderNotes: "Soup is on Theo this month.",
  members: [member, coleader, leader],
};

function client(overrides: Partial<HouseChurchesClient> = {}): HouseChurchesClient {
  return {
    searchReviewContacts: async () => ({ matches: [] }),
    setCoach: async () => ({ coaches: [] }),
    feedbackHistory: async () => ({ houses: [], since: "2026-08-27" }),
    feedbackLink: async () => ({ path: "/serve/missio/feedback/abc" }),
    listHouses: async () => ({ houses: [], canWrite: true }),
    getHouse: async () => ({ house, canWrite: true }),
    addMember: async () => ({ member }),
    updateMemberRole: async () => ({ member: { ...member, role: "co_leader" } }),
    removeMember: async () => ({ ok: true }),
    listReview: async () => ({ items: [] }),
    resolveReview: async () => {
      throw new Error("unused");
    },
    ...overrides,
  };
}

describe("house detail", () => {
  const roots: Array<ReturnType<typeof render>["root"]> = [];
  const hosts: HTMLElement[] = [];

  afterEach(() => cleanup(roots, hosts));

  function mount(node: ReactNode) {
    const view = render(node);
    roots.push(view.root);
    hosts.push(view.host);
    return view.host;
  }

  it("lists leaders, co-leaders, and members with campus and dates", async () => {
    const host = mount(<HouseDetailView houseId="house-2" client={client()} />);
    await settle();
    expect(host.textContent).toContain("Oak Table");
    expect(host.textContent).toContain("House 2");
    expect(host.textContent).toContain("Missio Potch");
    expect(host.textContent).not.toContain("Main");
    expect(host.querySelector("[data-testid=house-health]")?.textContent).toContain("3people");
    expect(host.querySelector("[data-testid=house-health]")?.textContent).toContain("Room to grow.");
    expect(host.querySelector("[data-testid=house-leading]")?.textContent).toContain("Leader · since 12 Mar 2024");
    expect(host.textContent).toContain("Wednesday");
    expect(host.textContent).toContain("9 Kestrel Lane");
    // Each lead shows their role under their name (board M3c), not a group heading.
    expect(host.querySelector("[data-testid=house-leading]")?.textContent).toContain("Theo Martins");
    expect(host.textContent).toContain("Theo Martins");
    expect(host.textContent).not.toContain("Leaders:");
    expect(host.querySelector("[data-testid=house-leading]")?.textContent).toContain("Co-leader");
    expect(host.textContent).toContain("Lindiwe Nkosi");
    expect(host.textContent).toContain("Soup is on Theo this month.");
    const names = [...host.querySelectorAll("[data-testid=house-members] li")].map((row) => row.textContent);
    expect(names[0]).toContain("Theo Martins");
    expect(names[1]).toContain("Lindiwe Nkosi");
    expect(names[2]).toContain("Amina Kruger");
    expect(names[0]).toContain("since 12 Mar 2024");
    expect(names[1]).not.toContain("since");
    const theo = host.querySelector("a[href='/missio/people/person-theo']");
    const lindi = [...host.querySelectorAll("[data-testid=house-members] li")].find((row) => row.textContent?.includes("Lindiwe"));
    expect(theo).toBeTruthy();
    expect(lindi?.querySelector("a")).toBeNull();
    expect(host.textContent).not.toMatch(/Delete/);
  });

  it("removes someone from the house and can change a role", async () => {
    const removed: string[] = [];
    const roles: string[] = [];
    const host = mount(
      <HouseDetailView
        houseId="house-2"
        client={client({
          removeMember: async (_houseId, contactId) => {
            removed.push(contactId);
            return { ok: true };
          },
          updateMemberRole: async (_houseId, contactId, role) => {
            roles.push(`${contactId}:${role}`);
            return { member: { ...member, role } };
          },
        })}
      />
    );
    await settle();
    expect(host.querySelector("button[aria-label='Remove Amina Kruger from house']")).toBeNull();
    const editAmina = host.querySelector("button[aria-label='Edit Amina Kruger']") as HTMLButtonElement;
    await act(async () => {
      editAmina.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const remove = document.body.querySelector("button[aria-label='Remove Amina Kruger from house']") as HTMLButtonElement;
    expect(remove.textContent?.trim()).toBe("Remove from house");
    await act(async () => {
      remove.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(removed).toEqual([]);
    const confirm = document.body.querySelector("button[aria-label='Confirm remove Amina Kruger']") as HTMLButtonElement;
    await act(async () => {
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(removed).toEqual(["c-amina"]);

    const editTheo = host.querySelector("button[aria-label='Edit Theo Martins']") as HTMLButtonElement;
    await act(async () => {
      editTheo.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const select = document.body.querySelector("[aria-label='Role for Theo Martins']") as HTMLSelectElement;
    await act(async () => {
      setValue(select, "member");
      await Promise.resolve();
    });
    expect(roles).toEqual(["c-theo:member"]);
  });

  it("adds two coaches from Missio people, then removes one", async () => {
    const calls: Array<[string, boolean]> = [];
    let coaches: Array<{ contactId: string; displayName: string; firstName: string; lastName: string; since: string }> = [];
    const people: Pick<MissioClient, "listPeople"> = {
      listPeople: async (query) => ({
        rows: [
          query?.q?.startsWith("Th")
            ? { id: "p-thandi", contactId: "c-thandi", name: "Thandi Zulu", campus: "potch", status: "active", joinedAt: null, currentStage: null }
            : { id: "p-pieter", contactId: "c-pieter", name: "Pieter van Wyk", campus: "potch", status: "active", joinedAt: null, currentStage: null },
        ],
        total: 1,
      }),
    };
    const names: Record<string, [string, string]> = { "c-thandi": ["Thandi", "Zulu"], "c-pieter": ["Pieter", "van Wyk"] };
    const host = mount(
      <HouseDetailView
        houseId="house-2"
        client={client({
          setCoach: async (_houseId, contactId, on) => {
            calls.push([contactId, on]);
            const [first, last] = names[contactId]!;
            coaches = on
              ? [...coaches, { contactId, displayName: `${first} ${last}`, firstName: first, lastName: last, since: "2026-11-19" }]
              : coaches.filter((coach) => coach.contactId !== contactId);
            return { coaches };
          },
        })}
        people={people}
      />
    );
    await settle();
    const row = host.querySelector("[data-testid=house-coach]") as HTMLElement;
    expect(row.textContent).toContain("No coach yet");
    for (const query of ["Thandi", "Pieter"]) {
      act(() => (row.querySelector("#house-coach-change") as HTMLButtonElement).click());
      await settle();
      setValue(row.querySelector("[data-testid=people-picker] input") as HTMLInputElement, query);
      await settle();
      (row.querySelector("[data-testid=people-picker]") as HTMLFormElement).requestSubmit();
      await settle();
      act(() => (row.querySelector("[data-testid=people-results] button") as HTMLButtonElement).click());
      await settle();
    }
    expect(calls).toEqual([
      ["c-thandi", true],
      ["c-pieter", true],
    ]);
    expect(row.querySelector("h3")?.textContent).toBe("Coaches");
    expect(row.textContent).toContain("Thandi Zulu");
    expect(row.textContent).toContain("Pieter van Wyk");
    expect(row.querySelector("#house-coach-change")?.textContent).toBe("Add another coach");
    act(() => (row.querySelector("[aria-label='Remove Thandi Zulu as coach']") as HTMLButtonElement).click());
    await settle();
    expect(calls.at(-1)).toEqual(["c-thandi", false]);
    expect(row.textContent).not.toContain("Thandi Zulu");
    expect(row.textContent).toContain("Pieter van Wyk");
  });

  it("adds a person from the people search when writing is allowed", async () => {
    const added: Array<{ contactId: string; role: string }> = [];
    const people: Pick<MissioClient, "listPeople"> = {
      listPeople: async () => ({
        rows: [
          {
            id: "person-elise",
            contactId: "c-elise",
            name: "Elise Navarro",
            campus: "potch",
            status: "active",
            joinedAt: null,
            currentStage: null,
          },
        ],
        total: 1,
      }),
    };
    const host = mount(
      <HouseDetailView
        houseId="house-2"
        client={client({
          addMember: async (_houseId, body) => {
            added.push(body);
            return { member };
          },
        })}
        people={people}
      />
    );
    await settle();
    const role = host.querySelector("[aria-label='Role for the new person']") as HTMLSelectElement;
    setValue(role, "co_leader");
    const input = host.querySelector("[data-testid=people-picker] input") as HTMLInputElement;
    setValue(input, "Elise");
    await settle();
    (host.querySelector("[data-testid=people-picker]") as HTMLFormElement).requestSubmit();
    await settle();
    const pick = [...host.querySelectorAll("[data-testid=people-results] button")].find((button) =>
      button.textContent?.includes("Elise Navarro")
    ) as HTMLButtonElement;
    pick.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(added).toEqual([{ contactId: "c-elise", role: "co_leader" }]);
  });

  it("hides write controls when canWrite is false", async () => {
    const host = mount(
      <HouseDetailView houseId="house-2" client={client({ getHouse: async () => ({ house, canWrite: false }) })} />
    );
    await settle();
    expect(host.querySelector("[data-testid=add-member]")).toBeNull();
    expect(host.querySelector("button[aria-label='Edit Amina Kruger']")).toBeNull();
    expect(document.body.querySelector("button[aria-label='Remove Amina Kruger from house']")).toBeNull();
    expect(host.textContent).toContain("Amina Kruger");
  });

  it("tells you someone has left Missio and refreshes the house without a loading flash", async () => {
    const serverText = "contact is no longer an active org_people row";
    let reads = 0;
    const refreshed: HouseDetail = {
      ...house,
      memberCount: 2,
      members: [coleader, leader],
    };
    const host = mount(
      <HouseDetailView
        houseId="house-2"
        client={client({
          getHouse: async () => {
            reads += 1;
            return { house: reads === 1 ? house : refreshed, canWrite: true };
          },
          removeMember: async () => {
            throw new MissioApiError(409, serverText, null, "member_left_missio");
          },
        })}
      />
    );
    await settle();
    const editAmina = host.querySelector("button[aria-label='Edit Amina Kruger']") as HTMLButtonElement;
    await act(async () => {
      editAmina.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const remove = document.body.querySelector("button[aria-label='Remove Amina Kruger from house']") as HTMLButtonElement;
    await act(async () => {
      remove.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const confirm = document.body.querySelector("button[aria-label='Confirm remove Amina Kruger']") as HTMLButtonElement;
    await act(async () => {
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("They’ve left Missio, so they can’t be changed here.");
    expect(document.body.textContent).not.toContain(serverText);
    expect(host.textContent).not.toContain("Loading this house");
    expect(host.textContent).toContain("Oak Table");
    expect(host.textContent).not.toContain("Amina Kruger");
    expect(reads).toBe(2);
  });

  it("says when the house cannot be found", async () => {
    const host = mount(
      <HouseDetailView
        houseId="missing"
        client={client({
          getHouse: async () => {
            throw new MissioApiError(404, "missing", null, "not_found");
          },
        })}
      />
    );
    await settle();
    expect(host.textContent).toMatch(/couldn.t be found/);
  });
});
