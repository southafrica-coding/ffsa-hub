/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MissioApiError } from "../api";
import type { HouseChurchesClient } from "./client";
import { HouseChurchGrid } from "./house-grid";
import type { HouseSummary } from "./types";
import { cleanup, render, settle } from "./test-render";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const oak: HouseSummary = {
  id: "house-2",
  number: 2,
  name: "Oak Table",
  campus: "jhb",
  meetingDay: "Wednesday",
  location: "9 Kestrel Lane",
  memberCount: 1,
  leaders: [
    { contactId: "c-theo", displayName: "Theo Martins", firstName: "Theo", lastName: "Martins", orgPersonId: "p-theo" },
  ],
  coLeaders: [
    { contactId: "c-lindi", displayName: "Lindiwe Nkosi", firstName: "Lindiwe", lastName: "Nkosi" },
  ],
};

const numbered: HouseSummary = {
  id: "house-4",
  number: 4,
  name: null,
  campus: "potch",
  meetingDay: null,
  location: null,
  memberCount: 6,
  leaders: [],
  coLeaders: [],
};

function client(overrides: Partial<HouseChurchesClient> = {}): HouseChurchesClient {
  return {
    listHouses: async () => ({ houses: [numbered, oak], canWrite: true }),
    getHouse: async () => {
      throw new Error("unused");
    },
    addMember: async () => {
      throw new Error("unused");
    },
    updateMemberRole: async () => {
      throw new Error("unused");
    },
    removeMember: async () => {
      throw new Error("unused");
    },
    listReview: async () => ({ items: [] }),
    resolveReview: async () => {
      throw new Error("unused");
    },
    ...overrides,
  };
}

describe("house church grid", () => {
  const roots: Array<ReturnType<typeof render>["root"]> = [];
  const hosts: HTMLElement[] = [];

  afterEach(() => cleanup(roots, hosts));

  function mount(node: ReactNode) {
    const view = render(node);
    roots.push(view.root);
    hosts.push(view.host);
    return view.host;
  }

  it("renders names, leaders, and counts in house-number order", async () => {
    const host = mount(<HouseChurchGrid client={client()} />);
    await settle();
    const cards = [...host.querySelectorAll("[data-testid=house-card]")];
    expect(cards).toHaveLength(2);
    expect(cards[0]?.getAttribute("href")).toBe("/missio/house-churches/house-2");
    expect(cards[0]?.textContent).toContain("Oak Table");
    expect(cards[0]?.textContent).toContain("House 2");
    expect(cards[0]?.textContent).toContain("1 person");
    expect(cards[0]?.textContent).toContain("Theo Martins");
    expect(cards[0]?.textContent).toContain("Lindiwe Nkosi");
    expect(cards[0]?.textContent).toContain("Missio JHB");
    expect(cards[0]?.textContent).toContain("Wednesday · 9 Kestrel Lane");
    expect(cards[1]?.getAttribute("href")).toBe("/missio/house-churches/house-4");
    expect(cards[1]?.textContent).toContain("House 4");
    expect(cards[1]?.textContent).toContain("6 people");
    expect(cards[1]?.textContent).toContain("Missio Potch");
    expect(cards[1]?.textContent).toContain("Main");
    expect(cards[1]?.textContent).toContain("Leaders: No one yet");
    expect(host.textContent).toContain("Review names");
    expect(host.textContent).not.toMatch(/Delete|Coming soon|Soon/);
  });

  it("hides review when the pastor cannot write", async () => {
    const host = mount(<HouseChurchGrid client={client({ listHouses: async () => ({ houses: [oak], canWrite: false }) })} />);
    await settle();
    expect(host.textContent).not.toContain("Review names");
    expect(host.querySelector("[data-testid=house-card]")).toBeTruthy();
  });

  it("shows an empty state when there are no houses", async () => {
    const host = mount(<HouseChurchGrid client={client({ listHouses: async () => ({ houses: [], canWrite: true }) })} />);
    await settle();
    expect(host.querySelector("[data-state=empty]")?.textContent).toContain("No house churches yet.");
    expect(host.querySelector("[data-testid=house-card]")).toBeNull();
  });

  it("retries after an error", async () => {
    let calls = 0;
    const host = mount(
      <HouseChurchGrid
        client={client({
          listHouses: async () => {
            calls += 1;
            if (calls === 1) throw new MissioApiError(500, "down", null, "server_error");
            return { houses: [oak], canWrite: true };
          },
        })}
      />
    );
    await settle();
    expect(host.querySelector("[data-state=error]")?.textContent).toContain("House churches didn’t load.");
    await act(async () => {
      host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Oak Table");
  });

  it("shows the pastors-only state on 403 and the sign-in state on 401", async () => {
    const denied = mount(
      <HouseChurchGrid client={client({ listHouses: async () => { throw new MissioApiError(403, "no", null, "forbidden"); } })} />
    );
    await settle();
    expect(denied.querySelector("[data-testid=missio-no-access]")?.getAttribute("data-status")).toBe("403");
    expect(denied.textContent).toMatch(/Pastors only/);

    const signedOut = mount(
      <HouseChurchGrid
        client={client({ listHouses: async () => { throw new MissioApiError(401, "no", null, "unauthenticated"); } })}
      />
    );
    await settle();
    expect(signedOut.querySelector("[data-testid=missio-no-access]")?.getAttribute("data-status")).toBe("401");
    expect(signedOut.textContent).toMatch(/Sign in required/);
  });
});
