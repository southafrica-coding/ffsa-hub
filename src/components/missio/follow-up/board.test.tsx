/** @vitest-environment happy-dom */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MissioApiError } from "../api";
import type { HouseSummary } from "../house-churches/types";
import { cleanup, render, setValue, settle } from "../house-churches/test-render";
import type { FollowUpClient } from "./client";
import { FollowUpBoard, resetMatchReviewSession } from "./board";
import type { FollowUpItem, FollowUpStage } from "./types";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  useRouter: () => ({ replace: nav.replace, refresh: () => {} }),
  usePathname: () => "/missio/follow-up",
}));

const css = readFileSync(path.join(process.cwd(), "src/components/missio/follow-up/follow-up.module.css"), "utf8");

const lerato: FollowUpItem = {
  key: "r_response-1",
  source: "connect_response",
  contactId: null,
  connectResponseId: "response-1",
  followupId: null,
  displayName: "Lerato Mokoena",
  phone: "082 555 0142",
  email: null,
  visitType: "first_time",
  wantsHouseChurch: true,
  wantsPrayer: true,
  stage: "new",
  assignedLeader: null,
  submittedAt: "2026-11-16T08:30:00.000Z",
  matchStatus: null,
  suggestedContact: null,
};

const sipho: FollowUpItem = {
  key: "c_contact-sipho",
  source: "contact",
  contactId: "contact-sipho",
  connectResponseId: null,
  followupId: "follow-sipho",
  displayName: "Sipho Dlamini with a very long name that must wrap on a phone",
  phone: null,
  email: "secret@example.com",
  visitType: "been_a_while",
  wantsHouseChurch: false,
  wantsPrayer: false,
  stage: "new",
  assignedLeader: { contactId: "contact-chris", displayName: "Chris Naidoo", firstName: "Chris", lastName: "Naidoo" },
  submittedAt: "2026-11-12T06:00:00.000Z",
  matchStatus: null,
  suggestedContact: null,
};

const house: HouseSummary = {
  id: "house-4",
  number: 4,
  name: "Oak Table",
  campus: "potch",
  meetingDay: "thursday",
  location: "14 Baobab Street",
  memberCount: 6,
  leaders: [],
  coLeaders: [],
  coach: null,
  coachSince: null,
};

function pages(people: FollowUpItem[]): Record<FollowUpStage, FollowUpItem[]> {
  return {
    new: people.filter((item) => item.stage === "new"),
    contacted: people.filter((item) => item.stage === "contacted"),
    visited_house: people.filter((item) => item.stage === "visited_house"),
    joined: people.filter((item) => item.stage === "joined"),
  };
}

describe("follow-up board", () => {
  const roots: Array<ReturnType<typeof render>["root"]> = [];
  const hosts: HTMLElement[] = [];

  afterEach(() => {
    nav.params = new URLSearchParams();
    resetMatchReviewSession();
    cleanup(roots, hosts);
    document.body.innerHTML = "";
  });

  function mount(node: ReactNode) {
    const view = render(node);
    roots.push(view.root);
    hosts.push(view.host);
    return view.host;
  }

  it("shows phones only on connect cards, hides email, and wraps the name", async () => {
    const nameRule = css.match(/\.name\s*\{[^}]+\}/)?.[0] ?? "";
    expect(nameRule).toMatch(/min-height:\s*44px/);
    expect(nameRule).toMatch(/overflow-wrap:\s*anywhere/);
    expect(nameRule).not.toMatch(/ellipsis|nowrap/);

    const host = mount(<FollowUpBoard client={client()} />);
    await settle();
    const cards = [...host.querySelectorAll("[data-testid=follow-up-card]")];
    expect(cards).toHaveLength(2);
    const leratoCard = cards[0] as HTMLElement;
    expect(leratoCard.querySelector("a[href='tel:0825550142']")).toBeTruthy();
    expect(leratoCard.querySelector("a[href='https://wa.me/27825550142']")).toBeTruthy();
    expect(leratoCard.textContent).not.toContain("secret@");
    expect(leratoCard.textContent).toContain("16 Nov 2026 · first time");
    expect(leratoCard.textContent).toContain("Wants a house church");
    expect(leratoCard.textContent).toContain("Wants prayer");
    const siphoCard = cards[1] as HTMLElement;
    expect(siphoCard.querySelector("a")).toBeNull();
    expect(siphoCard.textContent).toContain("Chris");
    expect(siphoCard.textContent).not.toContain("secret@example.com");
    expect(siphoCard.querySelector("button")?.textContent).toBe(sipho.displayName);
    expect(leratoCard.textContent).toContain("Assign");
    expect(leratoCard.textContent).toContain("Next stage");
    const stages = host.querySelector("[aria-label=Stage]") as HTMLElement;
    expect(stages.textContent).toContain("New");
    expect(stages.textContent).toContain("Joined");
    expect(stages.textContent).toContain("2");
    expect(host.querySelector("[data-testid=follow-up-lede]")?.textContent).toBe("2 people not in a house yet.");
  });

  it("moves a card on with Next stage", async () => {
    const people = [lerato, sipho];
    const calls: string[] = [];
    const host = mount(
      <FollowUpBoard
        client={client({
          list: async (query) => ({ people: pages(people)[query.stage], canWrite: true }),
          setStage: async (key, body) => {
            calls.push(`${key}:${body.stage}`);
            people[0] = { ...lerato, stage: body.stage };
            return {
              person: people[0],
              entry: { id: "e", kind: "stage_change", fromStage: "new", toStage: body.stage, body: null, by: null, at: "2026-11-16T10:00:00.000Z" },
            };
          },
        })}
      />
    );
    await settle();
    act(() => (host.querySelector("#follow-up-next-r_response-1") as HTMLButtonElement).click());
    await settle();
    expect(calls).toEqual(["r_response-1:contacted"]);
    expect(host.textContent).not.toContain("Lerato Mokoena");
    const contacted = [...host.querySelectorAll("[aria-label=Stage] button")].find((b) => b.textContent?.includes("Contacted"));
    expect(contacted?.textContent).toContain("1");
  });

  it("shows Joined as its own tab, and an empty state there", async () => {
    const host = mount(<FollowUpBoard client={client()} />);
    await settle();
    const joined = [...host.querySelectorAll("[aria-label=Stage] button")].find((b) => b.textContent?.includes("Joined")) as HTMLButtonElement;
    act(() => joined.click());
    await settle();
    expect(joined.getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).toContain("No one has joined a house from follow-up yet.");
  });

  it("shows four columns on a wide screen", async () => {
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: media.includes("1100px"),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    try {
      const host = mount(<FollowUpBoard client={client()} />);
      await settle();
      expect(host.querySelector("[data-testid=follow-up-columns]")).toBeTruthy();
      expect(host.querySelectorAll("[data-testid=follow-up-columns] section")).toHaveLength(4);
      expect(host.querySelectorAll("[data-testid=follow-up-list-new] [data-testid=follow-up-card]")).toHaveLength(2);
      expect(host.textContent).toContain("Moves here by itself when someone is added to a house.");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses the pastors-only card for 401 and 403 and never the server sentence", async () => {
    for (const [status, code] of [
      [401, "unauthenticated"],
      [403, "forbidden"],
    ] as const) {
      const host = mount(
        <FollowUpBoard
          client={client({
            list: async () => {
              throw new MissioApiError(status, "RAW SERVER TEXT", null, code);
            },
          })}
        />
      );
      await settle();
      expect(host.querySelector("[data-testid=missio-no-access]")?.getAttribute("data-status")).toBe(String(status));
      expect(host.textContent).not.toContain("RAW SERVER TEXT");
      act(() => {
        roots.pop()?.unmount();
        hosts.pop()?.remove();
      });
    }
  });

  it("hides write controls when canWrite is false", async () => {
    const host = mount(<FollowUpBoard client={client({ list: async (query) => ({ people: query.stage === "new" ? [lerato] : [], canWrite: false }) })} />);
    await settle();
    expect(host.querySelector("select")).toBeTruthy();
    expect(host.querySelector("[aria-label^='Stage for']")).toBeNull();
    expect(host.textContent).not.toContain("Add to a house");
    const open = host.querySelector("[id='follow-up-open-r_response-1']") as HTMLButtonElement;
    act(() => open.click());
    await settle();
    expect(document.body.textContent).toContain("Called on Tuesday.");
    expect(document.body.textContent?.indexOf("Called on Tuesday.")).toBeLessThan(
      document.body.textContent?.indexOf("Sent a connect card") ?? 0
    );
    expect(document.body.textContent).not.toContain("Add a note");
  });

  it("keeps the list in place after a stage change and focuses the next card", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const people = [lerato, sipho];
    const host = mount(
      <FollowUpBoard
        client={client({
          list: async (query) => {
            calls += 1;
            if (calls > 4) await gate;
            const grouped = pages(people);
            return { people: grouped[query.stage], canWrite: true };
          },
          setStage: async () => {
            people[0] = { ...lerato, stage: "contacted" };
            return {
              person: people[0],
              entry: {
                id: "e1",
                kind: "stage_change",
                fromStage: "new",
                toStage: "contacted",
                body: null,
                by: { displayName: "Chris Naidoo" },
                at: "2026-11-16T10:00:00.000Z",
              },
            };
          },
        })}
      />
    );
    await settle();
    act(() => {
      (host.querySelector("#follow-up-open-r_response-1") as HTMLButtonElement).click();
    });
    await settle();
    const select = document.body.querySelector("[aria-label='Stage for Lerato Mokoena']") as HTMLSelectElement;
    await act(async () => {
      setValue(select, "contacted");
      await Promise.resolve();
    });
    await settle();
    expect(host.textContent).not.toContain("Lerato Mokoena");
    expect(host.textContent).toContain("Sipho Dlamini");
    expect(host.textContent).not.toContain("Loading follow-up");
    expect(host.textContent).not.toContain("Loading this list");
    expect(document.activeElement?.id).toBe("follow-up-open-c_contact-sipho");
    release();
    await settle();
    expect(host.textContent).not.toContain("Loading follow-up");
  });

  it("says someone else updated the row and refetches without a loading flash", async () => {
    let calls = 0;
    const host = mount(
      <FollowUpBoard
        client={client({
          list: async (query) => {
            calls += 1;
            return { people: query.stage === "new" ? [lerato, sipho] : [], canWrite: true };
          },
          setLeader: async () => {
            throw new MissioApiError(409, "This row is already resolved.", null, "already_resolved");
          },
        })}
      />
    );
    await settle();
    const before = calls;
    act(() => {
      (host.querySelector("#follow-up-open-r_response-1") as HTMLButtonElement).click();
    });
    await settle();
    const select = document.body.querySelector("[aria-label='Leader for Lerato Mokoena']") as HTMLSelectElement;
    await act(async () => {
      setValue(select, "contact-chris");
      await Promise.resolve();
    });
    await settle();
    expect(host.textContent).toContain("Someone else already updated this.");
    expect(host.textContent).not.toContain("already resolved");
    expect(host.textContent).toContain("Lerato Mokoena");
    expect(host.textContent).not.toContain("Loading follow-up");
    expect(calls).toBeGreaterThan(before);
    expect(document.activeElement?.id).toBe("follow-up-leader-r_response-1");
  });

  it("creates a contact for an r_ card, then adds them to the house", async () => {
    const steps: string[] = [];
    let moved = false;
    const host = mount(
      <FollowUpBoard
        client={client({
          list: async (query) => {
            const rows = pages(moved ? [sipho] : [lerato, sipho]);
            return { people: rows[query.stage], canWrite: true };
          },
          createContact: async (key) => {
            steps.push(`contact:${key}`);
            moved = true;
            return { person: { ...lerato, contactId: "contact-lerato" } };
          },
        })}
        houses={{
          listHouses: async () => ({ houses: [house], canWrite: true }),
          addMember: async (houseId, body) => {
            steps.push(`member:${houseId}:${body.contactId}:${body.role}`);
            return {
              member: {
                contactId: body.contactId,
                displayName: "Lerato Mokoena",
                firstName: "Lerato",
                lastName: "Mokoena",
                role: body.role,
                startedAt: null,
              },
            };
          },
        }}
      />
    );
    await settle();
    act(() => {
      (host.querySelector("#follow-up-add-r_response-1") as HTMLButtonElement).click();
    });
    await settle();
    expect(document.body.textContent).toContain("Thursday");
    expect(document.body.textContent).not.toContain("thursday");
    act(() => {
      (document.body.querySelector("[data-testid=add-house] button") as HTMLButtonElement).click();
    });
    await settle();
    const confirm = [...document.body.querySelectorAll("button")].find((item) => item.textContent === "Add to this house") as HTMLButtonElement;
    act(() => confirm.click());
    await settle();
    expect(steps).toEqual(["contact:r_response-1", "member:house-4:contact-lerato:member"]);
    expect(host.textContent).not.toContain("Lerato Mokoena");
    expect(document.activeElement?.id).toBe("follow-up-open-c_contact-sipho");
  });

  it("asks the pastor to search when the contact already exists", async () => {
    const host = mount(
      <FollowUpBoard
        client={client({
          createContact: async () => {
            throw new MissioApiError(409, "RAW SERVER TEXT", null, "exists_use_search");
          },
        })}
        houses={{
          listHouses: async () => ({ houses: [house], canWrite: true }),
          addMember: async () => {
            throw new Error("unused");
          },
        }}
      />
    );
    await settle();
    act(() => (host.querySelector("#follow-up-add-r_response-1") as HTMLButtonElement).click());
    await settle();
    act(() => (document.body.querySelector("[data-testid=add-house] button") as HTMLButtonElement).click());
    await settle();
    const confirm = [...document.body.querySelectorAll("button")].find((item) => item.textContent === "Add to this house") as HTMLButtonElement;
    act(() => confirm.click());
    await settle();
    expect(document.body.textContent).toContain("Search for them and link them.");
    expect(document.body.textContent).not.toContain("RAW SERVER TEXT");
    expect(document.body.querySelector("[data-testid=people-picker]")).toBeTruthy();
  });

  it("reviews a pending phone match, confirms it, and leaves unknown statuses alone", async () => {
    const suggested = {
      ...lerato,
      key: "r_review",
      displayName: "Naledi Khumalo",
      phone: "083 555 0199",
      matchStatus: "pending_confirm",
      suggestedContact: { contactId: "contact-naledi", displayName: "Naledi Khumalo" },
    };
    const ordinary = { ...sipho, matchStatus: "linked", suggestedContact: { contactId: "c-x", displayName: "Should stay hidden" } };
    let confirmed = false;
    const host = mount(
      <FollowUpBoard
        client={client({
          list: async (query) => ({
            people: query.stage === "new" ? [confirmed ? { ...suggested, matchStatus: "confirmed", suggestedContact: null } : suggested, ordinary] : [],
            canWrite: true,
          }),
          confirmMatch: async () => {
            confirmed = true;
            return { person: { ...suggested, matchStatus: "confirmed", suggestedContact: null } };
          },
        })}
      />
    );
    await settle();
    const panel = host.querySelector("[data-testid=needs-review-panel]") as HTMLElement;
    expect(panel.textContent).toContain("Needs review · 1");
    const review = panel.querySelector("[data-testid=needs-review]") as HTMLElement;
    expect(review.textContent).toContain("In People");
    expect(review.textContent).toContain("Naledi Khumalo");
    // The card's own phone shows; the suggested contact's never does.
    expect(review.textContent).toContain("083 555 0199");
    expect(host.textContent).not.toContain("Should stay hidden");
    const confirm = [...review.querySelectorAll("button")].find((item) => item.textContent === "Confirm, it’s Naledi") as HTMLButtonElement;
    act(() => confirm.click());
    await settle();
    expect(host.querySelector("[data-testid=needs-review-panel]")).toBeNull();
    expect(host.textContent).toContain("Naledi Khumalo");
  });

  it("shows Needs review with no name when there is no suggested contact", async () => {
    const host = mount(
      <FollowUpBoard
        client={client({
          list: async (query) => ({
            people: query.stage === "new" ? [{ ...lerato, displayName: "Johan Botha", matchStatus: "pending_confirm", suggestedContact: null }] : [],
            canWrite: true,
          }),
        })}
      />
    );
    await settle();
    const review = host.querySelector("[data-testid=needs-review]") as HTMLElement;
    expect(review.textContent).toContain("No one suggested yet.");
    expect(review.querySelector("button")).toBeNull();
    expect(host.querySelector("[data-testid=follow-up-card]")?.textContent).toContain("Needs review");
  });

  it("says someone already sorted a match and refetches", async () => {
    let calls = 0;
    const host = mount(
      <FollowUpBoard
        client={client({
          list: async (query) => {
            calls += 1;
            return {
              people: query.stage === "new" ? [{ ...lerato, matchStatus: "pending_confirm", suggestedContact: { contactId: "c1", displayName: "Naledi Khumalo" } }] : [],
              canWrite: true,
            };
          },
          confirmMatch: async () => {
            throw new MissioApiError(409, "RAW SERVER TEXT", null, "already_resolved");
          },
        })}
      />
    );
    await settle();
    const before = calls;
    const confirm = [...host.querySelectorAll("button")].find((item) => item.textContent?.startsWith("Confirm")) as HTMLButtonElement;
    act(() => confirm.click());
    await settle();
    expect(host.textContent).toContain("Someone already sorted this one.");
    expect(host.textContent).not.toContain("RAW SERVER TEXT");
    expect(calls).toBeGreaterThan(before);
  });

  it("hides Not this person for the session when decline is not available", async () => {
    const person = {
      ...lerato,
      matchStatus: "pending_confirm",
      suggestedContact: { contactId: "c1", displayName: "Naledi Khumalo" },
    };
    const host = mount(
      <FollowUpBoard
        client={client({
          list: async (query) => ({ people: query.stage === "new" ? [person, { ...person, key: "r_other", displayName: "Ayesha Patel" }] : [], canWrite: true }),
          declineMatch: async () => {
            throw new MissioApiError(501, "RAW SERVER TEXT", null, "not_available");
          },
        })}
      />
    );
    await settle();
    expect(host.textContent).toContain("Not this person");
    const decline = [...host.querySelectorAll("button")].find((item) => item.textContent === "Not this person") as HTMLButtonElement;
    act(() => decline.click());
    await settle();
    expect(host.textContent).not.toContain("Not this person");
    expect(host.textContent).toContain("That didn’t work. Please try again.");
    expect(host.textContent).not.toContain("RAW SERVER TEXT");
    expect(host.textContent).toContain("Ayesha Patel");
  });
});

function client(overrides: Partial<FollowUpClient> = {}): FollowUpClient {
  const grouped = pages([lerato, sipho]);
  return {
    list: async (query) => ({ people: grouped[query.stage], canWrite: true }),
    leaders: async () => ({
      leaders: [{ contactId: "contact-chris", displayName: "Chris Naidoo", firstName: "Chris", lastName: "Naidoo" }],
    }),
    setStage: async () => {
      throw new Error("unused");
    },
    setLeader: async () => {
      throw new Error("unused");
    },
    timeline: async () => ({
      entries: [
        {
          id: "old",
          kind: "submitted",
          fromStage: null,
          toStage: null,
          body: null,
          by: null,
          at: "2026-11-01T08:00:00.000Z",
        },
        {
          id: "new",
          kind: "note",
          fromStage: null,
          toStage: null,
          body: "Called on Tuesday.",
          by: { displayName: "Chris Naidoo" },
          at: "2026-11-16T09:00:00.000Z",
        },
      ],
    }),
    addNote: async () => {
      throw new Error("unused");
    },
    createContact: async () => {
      throw new Error("unused");
    },
    confirmMatch: async () => ({ person: null }),
    declineMatch: async () => ({ person: null }),
    ...overrides,
  };
}
