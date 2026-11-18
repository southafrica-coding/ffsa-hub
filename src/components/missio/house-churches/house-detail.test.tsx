/** @vitest-environment happy-dom */
import type { ReactNode } from "react";
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
  leaderNotes: "Soup is on Theo this month.",
  members: [member, coleader, leader],
};

function client(overrides: Partial<HouseChurchesClient> = {}): HouseChurchesClient {
  return {
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
    expect(host.textContent).toContain("Main");
    expect(host.textContent).toContain("3 people");
    expect(host.textContent).toContain("Wednesday · 9 Kestrel Lane");
    expect(host.textContent).toContain("Leaders: Theo Martins");
    expect(host.textContent).toContain("Co-leaders: Lindiwe Nkosi");
    expect(host.textContent).toContain("Soup is on Theo this month.");
    const names = [...host.querySelectorAll("[data-testid=house-members] li")].map((row) => row.textContent);
    expect(names[0]).toContain("Theo Martins");
    expect(names[1]).toContain("Lindiwe Nkosi");
    expect(names[2]).toContain("Amina Kruger");
    expect(names[0]).toContain("Since 12 Mar 2024");
    expect(names[1]).not.toContain("Since");
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
    const remove = host.querySelector("button[aria-label='Remove Amina Kruger from house']") as HTMLButtonElement;
    expect(remove.textContent?.trim()).toBe("Remove from house");
    await settle();
    remove.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(removed).toEqual(["c-amina"]);

    const select = host.querySelector("[aria-label='Role for Theo Martins']") as HTMLSelectElement;
    await settle();
    setValue(select, "member");
    await settle();
    expect(roles).toEqual(["c-theo:member"]);
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
    const input = host.querySelector("[aria-label='Search people']") as HTMLInputElement;
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
    expect(host.querySelector("button[aria-label='Remove Amina Kruger from house']")).toBeNull();
    expect(host.textContent).toContain("Amina Kruger");
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
