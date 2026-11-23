/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MissioHome, houseOverview } from "./home";
import type { FollowUpClient } from "./follow-up/client";
import type { HouseChurchesClient } from "./house-churches/client";
import type { HouseSummary } from "./house-churches/types";
import type { MissioMe } from "./types-shim";
import { MissioViewerProvider } from "./viewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const pastor: MissioMe = {
  orgs: [{ id: "org-missio", slug: "missio", name: "Missio" }],
  rolesByOrg: { missio: ["pastor"] },
  currentOrg: "missio",
};

const houseLeader: MissioMe = {
  orgs: [{ id: "org-missio", slug: "missio", name: "Missio" }],
  rolesByOrg: { missio: ["house_church_leader"] },
  currentOrg: "missio",
};

function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, root };
}

function house(number: number, memberCount: number, leaders = 1, coLeaders = 1): HouseSummary {
  const person = (n: number) => ({ contactId: `c${number}-${n}`, displayName: `Person ${n}`, firstName: "Person", lastName: String(n) });
  return {
    id: `house-${number}`,
    number,
    name: null,
    campus: "potch",
    meetingDay: null,
    location: null,
    memberCount,
    leaders: Array.from({ length: leaders }, (_, n) => person(n)),
    coLeaders: Array.from({ length: coLeaders }, (_, n) => person(10 + n)),
    coaches: [],
  };
}

const sample = [house(2, 9, 1, 0), house(1, 24), house(3, 18), house(4, 0, 0, 0), house(5, 6, 0, 1)];

function clients(options: { failHouses?: boolean; review?: number } = {}) {
  let houseCalls = 0;
  const houses = {
    listHouses: async () => {
      houseCalls += 1;
      if (options.failHouses && houseCalls === 1) throw new Error("down");
      return { houses: sample, canWrite: true };
    },
    listReview: async () => ({ items: Array.from({ length: options.review ?? 0 }, (_, n) => ({ id: `r${n}` })) }),
  } as unknown as HouseChurchesClient;
  const counts: Record<string, number> = { new: 3, contacted: 2, visited_house: 1 };
  const followUp = {
    list: async ({ stage }: { stage: string }) => ({
      // Two of the new ones came in on a connect card; one needs a pastor to confirm a match.
      people: Array.from({ length: counts[stage] ?? 0 }, (_, n) => ({
        key: `${stage}-${n}`,
        source: stage === "new" && n < 2 ? "connect_response" : "contact",
        matchStatus: stage === "new" && n === 0 ? "pending_confirm" : null,
      })),
      canWrite: true,
    }),
  } as unknown as FollowUpClient;
  const people = { listPeople: async () => ({ rows: [], total: 251 }) };
  const loadName = async () => "Gabriël";
  return { houses, followUp, people, loadName };
}

async function settle() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("houseOverview", () => {
  it("counts houses, people and signals, and leaves an empty house out of the signals", () => {
    const overview = houseOverview(sample);
    expect(overview.houses).toBe(5);
    expect(overview.people).toBe(57);
    expect(overview.readyToMultiply).toBe(2);
    expect(overview.noCoLeader).toBe(1);
    expect(overview.noLeader).toBe(1);
    expect(overview.bars.map((bar) => bar.number)).toEqual([1, 2, 3, 4, 5]);
    expect(overview.bars.filter((bar) => bar.ready).map((bar) => bar.number)).toEqual([1, 3]);
    expect(overview.readyToLead).toBeNull();
    expect(houseOverview([{ ...house(1, 20), readyToLead: 2 }, { ...house(2, 8), readyToLead: 0 }]).readyToLead).toBe(2);
  });
});

describe("Missio home", () => {
  const roots: Root[] = [];
  const hosts: HTMLElement[] = [];

  afterEach(() => {
    while (roots.length) act(() => roots.pop()?.unmount());
    while (hosts.length) hosts.pop()?.remove();
  });

  it("shows a pastor the houses, the review queue and who is not in a house yet", async () => {
    const { host, root } = render(
      <MissioViewerProvider me={pastor}>
        <MissioHome {...clients({ review: 135 })} />
      </MissioViewerProvider>
    );
    roots.push(root);
    hosts.push(host);
    await settle();
    const housesCard = host.querySelector("[data-testid=home-houses-card]") as HTMLElement;
    expect(housesCard.textContent).toContain("5houses");
    expect(housesCard.textContent).toContain("57members");
    expect(housesCard.textContent).toContain("2 ready to multiply");
    expect(housesCard.textContent).toContain("1 no co-leader");
    expect(housesCard.textContent).toContain("1 no leader");
    // No house reports readyToLead, so there is no third number to show.
    expect(housesCard.textContent).not.toContain("ready to lead");
    expect(housesCard.querySelector("[role=img]")?.getAttribute("aria-label")).toContain("24, 9, 18, 0, 6");
    expect((host.querySelector("[data-testid=home-houses]") as HTMLAnchorElement).getAttribute("href")).toBe("/missio/house-churches");
    const review = host.querySelector("[data-testid=home-review]") as HTMLAnchorElement;
    expect(review.getAttribute("href")).toBe("/missio/house-churches/review");
    expect(review.textContent).toContain("135 names to review");
    const followCard = host.querySelector("[data-testid=home-follow-card]") as HTMLElement;
    expect(followCard.textContent).toContain("Not in a house yet");
    expect(followCard.textContent).toContain("6");
    expect(followCard.textContent).toContain("3New");
    expect(followCard.textContent).toContain("3 new · 2 from Sunday");
    expect(followCard.textContent).toContain("1 need review");
    expect((host.querySelector("[data-testid=home-follow-up]") as HTMLAnchorElement).getAttribute("href")).toBe("/missio/follow-up");
    const find = host.querySelector("[data-testid=home-people]") as HTMLAnchorElement;
    expect(find.getAttribute("href")).toBe("/missio/people");
    expect(find.textContent).toContain("251 people");
    expect(host.querySelector("[data-testid=home-hero] h1")?.textContent).toMatch(/^Good (morning|afternoon|evening), Gabriël$/);
    expect(host.textContent).not.toMatch(/Soon|Coming soon/);
  });

  it("keeps the This Sunday and want-to-serve slots honest while nothing is linked", async () => {
    const { host, root } = render(
      <MissioViewerProvider me={pastor}>
        <MissioHome {...clients()} />
      </MissioViewerProvider>
    );
    roots.push(root);
    hosts.push(host);
    await settle();
    const sunday = host.querySelector("[data-testid=home-sunday]") as HTMLAnchorElement;
    expect(sunday.getAttribute("href")).toBe("/missio/sundays");
    expect(sunday.textContent).toContain("This Sunday");
    expect(sunday.textContent).toContain("Sundays aren’t linked yet");
    // No plan, times or team counts are made up.
    expect(sunday.textContent).not.toMatch(/\d+ of \d+|\d{2}:\d{2}|preaching/);
    const serve = host.querySelector("[data-testid=home-serve]") as HTMLAnchorElement;
    expect(serve.getAttribute("href")).toBe("/missio/volunteers");
    expect(serve.textContent).toContain("No serving sign-ups in the Hub yet");
    expect(serve.textContent).not.toMatch(/\d/);
  });

  it("hides the review notice when nothing is waiting", async () => {
    const { host, root } = render(
      <MissioViewerProvider me={pastor}>
        <MissioHome {...clients()} />
      </MissioViewerProvider>
    );
    roots.push(root);
    hosts.push(host);
    await settle();
    expect(host.querySelector("[data-testid=home-review]")).toBeNull();
  });

  it("keeps the other cards when house churches fail, and retries", async () => {
    const { host, root } = render(
      <MissioViewerProvider me={pastor}>
        <MissioHome {...clients({ failHouses: true })} />
      </MissioViewerProvider>
    );
    roots.push(root);
    hosts.push(host);
    await settle();
    const housesCard = host.querySelector("[data-testid=home-houses-card]") as HTMLElement;
    expect(housesCard.querySelector("[role=alert]")?.textContent).toContain("Couldn’t load house churches");
    expect(host.querySelector("[data-testid=home-follow-card]")?.textContent).toContain("3New");
    await act(async () => {
      (housesCard.querySelector("button") as HTMLButtonElement).click();
    });
    await settle();
    expect(housesCard.querySelector("[role=alert]")).toBeNull();
    expect(housesCard.textContent).toContain("5houses");
  });

  it("shows a leader their own houses, and none of the pastor cards", async () => {
    let called = 0;
    const spy = clients();
    const houses = {
      ...spy.houses,
      listHouses: async () => {
        called += 1;
        return { houses: [{ ...house(5, 12), name: null }], canWrite: false };
      },
    } as HouseChurchesClient;
    const { host, root } = render(
      <MissioViewerProvider me={houseLeader}>
        <MissioHome houses={houses} followUp={spy.followUp} />
      </MissioViewerProvider>
    );
    roots.push(root);
    hosts.push(host);
    await settle();
    expect(host.querySelector("[data-testid=home-my-houses]")?.textContent).toContain("House 5");
    expect(host.querySelector("[data-testid=home-people]")).toBeNull();
    expect(host.querySelector("[data-testid=home-houses-card]")).toBeNull();
    expect(host.querySelector("[data-testid=home-follow-card]")).toBeNull();
    expect(called).toBe(1);
  });
});
