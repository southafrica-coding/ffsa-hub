/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MissioHome, houseOverview } from "./home";
import type { FollowUpClient } from "./follow-up/client";
import type { FeedbackThisWeek, FeedbackThisWeekClient } from "./feedback/this-week";
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

const coach: MissioMe = {
  orgs: [{ id: "org-missio", slug: "missio", name: "Missio" }],
  rolesByOrg: { missio: ["coach"] },
  currentOrg: "missio",
};

const H4 = "44444444-4444-4444-8444-444444444444";
const H9 = "99999999-9999-4999-8999-999999999999";
const WEEK: FeedbackThisWeek = {
  sunday: "2026-11-22",
  total: 20,
  sentCount: 18,
  missing: [
    { id: H4, number: 4, name: "Sipho & Naledi" },
    { id: H9, number: 9, name: null },
  ],
};

function weekClient(result: () => Promise<FeedbackThisWeek | null>) {
  let calls = 0;
  const client: FeedbackThisWeekClient = {
    thisWeek: () => {
      calls += 1;
      return result();
    },
  };
  return { client, calls: () => calls };
}

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
  const feedback: FeedbackThisWeekClient = { thisWeek: async () => WEEK };
  return { houses, followUp, people, loadName, feedback };
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
    expect(overview.bars.map((bar) => bar.number)).toEqual([1, 2, 3, 4, 5]);
    expect(overview.bars.filter((bar) => bar.ready).map((bar) => bar.number)).toEqual([1, 3]);
  });
});

describe("Missio home", () => {
  const roots: Root[] = [];
  const hosts: HTMLElement[] = [];

  afterEach(() => {
    while (roots.length) act(() => roots.pop()?.unmount());
    while (hosts.length) hosts.pop()?.remove();
  });

  it("shows a pastor the houses and who is not in a house yet", async () => {
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
    // Board M11a: no "no leader" chip, and no stand-in for the "new this month" number.
    expect(housesCard.textContent).not.toContain("no leader");
    expect(housesCard.textContent).not.toContain("ready to lead");
    expect(housesCard.querySelectorAll("dl > div")).toHaveLength(2);
    expect(housesCard.querySelector("[role=img]")?.getAttribute("aria-label")).toContain("24, 9, 18, 0, 6");
    expect((host.querySelector("[data-testid=home-houses]") as HTMLAnchorElement).getAttribute("href")).toBe("/missio/house-churches");
    // Names to review live on the House churches page, not this card.
    expect(host.querySelector("[data-testid=home-review]")).toBeNull();
    expect(housesCard.textContent).not.toContain("to review");
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

  function mount(me: MissioMe, node: ReactNode) {
    const view = render(<MissioViewerProvider me={me}>{node}</MissioViewerProvider>);
    roots.push(view.root);
    hosts.push(view.host);
    return view.host;
  }

  it("puts Weekly feedback under the greeting for a pastor: the form, the copy link and who hasn't sent", async () => {
    const host = mount(pastor, <MissioHome {...clients()} />);
    await settle();
    const card = host.querySelector("[data-testid=home-weekly-card]") as HTMLElement;
    expect(card).toBeTruthy();
    // Straight after the greeting, before the house churches grid.
    expect(host.querySelector("[data-testid=home-hero]")?.nextElementSibling).toBe(card);
    expect(card.compareDocumentPosition(host.querySelector("[data-testid=home-houses-card]") as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const cta = card.querySelector("[data-testid=home-weekly-cta]") as HTMLAnchorElement;
    expect(cta.getAttribute("href")).toBe("/f/missio-weekly-feedback");
    expect(cta.textContent).toBe("Fill in this week’s feedback");
    expect(card.querySelector("[data-testid=public-feedback-copy]")).toBeTruthy();
    const missing = card.querySelector("[data-testid=home-weekly-missing]") as HTMLElement;
    expect(missing.textContent).toContain("Not sent yet");
    expect(card.querySelector("[data-testid=home-weekly-count]")?.textContent).toBe("18 of 20 sent");
    expect(missing.textContent).toContain("Week ending Sunday 22 November");
    const rows = [...card.querySelectorAll("[data-testid=home-weekly-missing-house]")] as HTMLAnchorElement[];
    expect(rows.map((a) => a.textContent)).toEqual(["House 4 · Sipho & Naledi", "House 9"]);
    expect(rows.map((a) => a.getAttribute("href"))).toEqual([`/f/missio-weekly-feedback?house=${H4}`, `/f/missio-weekly-feedback?house=${H9}`]);
  });

  it("says so when every house has sent", async () => {
    const { client } = weekClient(async () => ({ ...WEEK, sentCount: 20, missing: [] }));
    const host = mount(pastor, <MissioHome {...clients()} feedback={client} />);
    await settle();
    const card = host.querySelector("[data-testid=home-weekly-card]") as HTMLElement;
    expect(card.querySelector("[data-testid=home-weekly-all-sent]")?.textContent).toContain("Every house has sent this week’s feedback");
    expect(card.querySelector("[data-testid=home-weekly-count]")?.textContent).toBe("20 of 20 sent");
    expect(card.querySelectorAll("[data-testid=home-weekly-missing-house]")).toHaveLength(0);
  });

  it("shows loading, then an error with a retry that works", async () => {
    let fail = true;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { client, calls } = weekClient(async () => {
      await gate;
      if (fail) throw new Error("down");
      return WEEK;
    });
    const host = mount(pastor, <MissioHome {...clients()} feedback={client} />);
    await settle();
    const card = host.querySelector("[data-testid=home-weekly-card]") as HTMLElement;
    expect(card.querySelector("[data-testid=home-weekly-missing] [aria-hidden=true]")).toBeTruthy();
    // The CTA and copy are there while the list loads.
    expect(card.querySelector("[data-testid=home-weekly-cta]")).toBeTruthy();
    release();
    await settle();
    expect(card.querySelector("[role=alert]")?.textContent).toContain("Couldn’t load this week’s feedback");
    fail = false;
    await act(async () => {
      (card.querySelector("[role=alert] button") as HTMLButtonElement).click();
    });
    await settle();
    expect(calls()).toBe(2);
    expect(card.querySelector("[role=alert]")).toBeNull();
    expect(card.querySelectorAll("[data-testid=home-weekly-missing-house]")).toHaveLength(2);
  });

  it("gives a leader the form and the copy link, but never the missing list", async () => {
    const spy = clients();
    const { client, calls } = weekClient(async () => WEEK);
    const houses = { ...spy.houses, listHouses: async () => ({ houses: [house(5, 12)], canWrite: false }) } as HouseChurchesClient;
    const host = mount(houseLeader, <MissioHome houses={houses} followUp={spy.followUp} loadName={spy.loadName} feedback={client} />);
    await settle();
    const card = host.querySelector("[data-testid=home-weekly-card]") as HTMLElement;
    expect(card).toBeTruthy();
    expect(host.querySelector("[data-testid=home-hero]")?.nextElementSibling).toBe(card);
    expect((card.querySelector("[data-testid=home-weekly-cta]") as HTMLAnchorElement).getAttribute("href")).toBe("/f/missio-weekly-feedback");
    expect(card.querySelector("[data-testid=public-feedback-copy]")).toBeTruthy();
    expect(card.querySelector("[data-testid=home-weekly-missing]")).toBeNull();
    expect(card.textContent).not.toContain("Not sent yet");
    expect(calls()).toBe(0);
  });

  it("gives a coach the missing list for their houses, and nothing when the API says no", async () => {
    const spy = clients();
    const houses = { ...spy.houses, listHouses: async () => ({ houses: [house(4, 8)], canWrite: false }) } as HouseChurchesClient;
    const ok = weekClient(async () => ({ sunday: "2026-11-22", total: 1, sentCount: 0, missing: [WEEK.missing[0]] }));
    let host = mount(coach, <MissioHome houses={houses} followUp={spy.followUp} loadName={spy.loadName} feedback={ok.client} />);
    await settle();
    expect(host.querySelectorAll("[data-testid=home-weekly-missing-house]")).toHaveLength(1);

    const no = weekClient(async () => null);
    host = mount(coach, <MissioHome houses={houses} followUp={spy.followUp} loadName={spy.loadName} feedback={no.client} />);
    await settle();
    const card = host.querySelector("[data-testid=home-weekly-card]") as HTMLElement;
    expect(card.querySelector("[data-testid=home-weekly-cta]")).toBeTruthy();
    expect(card.querySelector("[data-testid=home-weekly-missing]")).toBeNull();
    expect(card.querySelector("[role=alert]")).toBeNull();
  });
});
