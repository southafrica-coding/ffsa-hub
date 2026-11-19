/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MissioApiError } from "../api";
import type { HouseChurchesClient } from "./client";
import { HouseChurchGrid } from "./house-grid";
import type { HouseSummary, ReviewItem } from "./types";
import { cleanup, render, setValue, settle } from "./test-render";

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
  coaches: [
    { contactId: "c-thandi", displayName: "Thandi Zulu", firstName: "Thandi", lastName: "Zulu", orgPersonId: "p-thandi", since: "2026-11-01" },
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
  coaches: [],
};

function client(overrides: Partial<HouseChurchesClient> = {}): HouseChurchesClient {
  return {
    searchReviewContacts: async () => ({ matches: [] }),
    setCoach: async () => ({ coaches: [] }),
    feedbackHistory: async () => ({ houses: [], since: "2026-08-27" }),
    feedbackLink: async () => ({ path: "/serve/missio/feedback/abc" }),
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

/** Coached houses open on the map. These tests are about the grid. */
async function toGrid(host: HTMLElement) {
  const grid = [...host.querySelectorAll("[aria-label=View] button")].find((b) => b.textContent === "Grid") as
    | HTMLButtonElement
    | undefined;
  if (grid) act(() => grid.click());
  await settle();
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

  it("renders houses biggest first, with leaders, size and signals", async () => {
    const host = mount(<HouseChurchGrid client={client()} />);
    await settle();
    expect(host.querySelector("[data-testid=house-totals]")?.textContent).toBe("2 houses · 7 members · 1 coach");
    await toGrid(host);
    const cards = [...host.querySelectorAll("[data-testid=house-card]")];
    expect(cards).toHaveLength(2);
    // Size, biggest first.
    expect(cards[0]?.getAttribute("href")).toBe("/missio/house-churches/house-4");
    expect(cards[0]?.textContent).toContain("House 4");
    expect(cards[0]?.textContent).toContain("6people");
    expect(cards[0]?.textContent).toContain("Missio Potch");
    expect(cards[0]?.textContent).toContain("No leader yet");
    expect(cards[0]?.textContent).toContain("No leader");
    expect(cards[0]?.textContent).toContain("No co-leader");
    expect(cards[1]?.getAttribute("href")).toBe("/missio/house-churches/house-2");
    expect(cards[1]?.textContent).toContain("Oak Table");
    expect(cards[1]?.textContent).toContain("House 2");
    expect(cards[1]?.textContent).toContain("Theo Martins & Lindiwe");
    expect(cards[1]?.textContent).toContain("Missio JHB");
    expect(cards[1]?.textContent).toContain("Wed");
    expect(cards[1]?.textContent).toContain("9 Kestrel Lane");
    expect(cards[1]?.textContent).not.toContain("No co-leader");
    const review = host.querySelector("[data-testid=review-names]");
    expect(review?.textContent).toBe("Review names");
    expect(review?.getAttribute("href")).toBe("/missio/house-churches/review");
    expect(host.textContent).not.toMatch(/Delete|Coming soon|Soon/);
  });

  it("filters by campus and needs attention, and sorts by number", async () => {
    const host = mount(<HouseChurchGrid client={client()} />);
    await settle();
    await toGrid(host);
    const chip = (label: string) =>
      [...host.querySelectorAll("[data-testid=house-filters] button")].find((b) => b.textContent === label) as HTMLButtonElement;
    act(() => chip("Missio JHB").click());
    await settle();
    expect(host.querySelectorAll("[data-testid=house-card]")).toHaveLength(1);
    act(() => chip("All campuses").click());
    act(() => chip("Needs attention").click());
    await settle();
    const left = [...host.querySelectorAll("[data-testid=house-card]")];
    expect(left).toHaveLength(1);
    expect(left[0]?.textContent).toContain("House 4");
    act(() => chip("Needs attention").click());
    await act(async () => {
      setValue(host.querySelector("[data-testid=house-filters] label:last-of-type select") as HTMLSelectElement, "number");
    });
    await settle();
    expect(host.querySelector("[data-testid=house-card]")?.getAttribute("href")).toBe("/missio/house-churches/house-2");
  });

  it("shows how many names are waiting when that count is known", async () => {
    const host = mount(
      <HouseChurchGrid
        client={client({
          listReview: async () => ({ items: Array.from({ length: 12 }, (_, index) => ({ id: `r-${index}` }) as ReviewItem) }),
        })}
      />
    );
    await settle();
    expect(host.querySelector("[data-testid=review-names]")?.textContent).toBe("Review names (12)");
  });

  it("hides review when the pastor cannot write", async () => {
    const host = mount(<HouseChurchGrid client={client({ listHouses: async () => ({ houses: [oak], canWrite: false }) })} />);
    await settle();
    await toGrid(host);
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
    expect(host.querySelector("[data-state=error]")?.textContent).toContain("Something went wrong on our side. Try again.");
    await act(async () => {
      host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Thandi Zulu");
  });

  it("opens on the map once houses have coaches: coach, then houses, then people", async () => {
    const host = mount(
      <HouseChurchGrid
        client={client({
          getHouse: async () => ({
            house: {
              ...oak,
              leaderNotes: null,
              members: [
                { ...oak.leaders[0]!, role: "leader", startedAt: "2026-01-01" },
                { contactId: "c-mia", displayName: "Mia Grobler", firstName: "Mia", lastName: "Grobler", role: "member", startedAt: "2026-02-01" },
              ],
            },
            canWrite: true,
          }),
        })}
      />
    );
    await settle();
    const map = host.querySelector("[data-testid=house-map]") as HTMLElement;
    expect(map).toBeTruthy();
    const coaches = [...map.querySelectorAll("[aria-label=Coaches] button")];
    expect(coaches.map((b) => b.textContent)).toEqual([
      expect.stringContaining("Thandi Zulu"),
      expect.stringContaining("No coach yet"),
    ]);
    expect(map.textContent).toContain("Choose a coach to see their houses.");
    act(() => (coaches[0] as HTMLButtonElement).click());
    await settle();
    expect(coaches[0]?.getAttribute("aria-expanded")).toBe("true");
    const house = [...map.querySelectorAll("[aria-label='Houses coached by Thandi Zulu'] button")];
    expect(house).toHaveLength(1);
    expect(house[0]?.textContent).toContain("Oak Table");
    act(() => (house[0] as HTMLButtonElement).click());
    await settle();
    const tray = host.querySelector("[data-testid=house-tray]") as HTMLElement;
    expect(tray.textContent).toContain("coached by Thandi Zulu");
    expect(tray.textContent).toContain("Mia Grobler");
    expect(tray.querySelector("a[href='/missio/house-churches/house-2']")?.textContent).toBe("Open house");
    // Opening the other coach closes this branch.
    act(() => (coaches[1] as HTMLButtonElement).click());
    await settle();
    expect(host.querySelector("[data-testid=house-tray]")).toBeNull();
    expect(map.textContent).toContain("House 4");
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
