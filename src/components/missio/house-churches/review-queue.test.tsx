/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MissioApiError, type MissioClient } from "../api";
import { createHouseChurchesClient, type HouseChurchesClient } from "./client";
import { ReviewQueue } from "./review-queue";
import type { ResolveBody, ReviewItem } from "./types";
import { cleanup, render, setValue, settle } from "./test-render";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const family: ReviewItem = {
  id: "review-family",
  status: "pending",
  sourceLine: 12,
  rawName: "The Adler family",
  kind: "family_label",
  matchType: "none",
  houseNumber: 4,
  house: { id: "house-4", number: 4, name: null },
  role: "leader",
  candidates: [
    {
      contactId: "c-peter",
      displayName: "Peter Adler",
      firstName: "Peter",
      lastName: "Adler",
      orgPersonId: "person-peter",
    },
  ],
  notes: "see house 4",
  createdAt: "2026-11-01T08:00:00.000Z",
  resolvedAt: null,
};

const partial: ReviewItem = {
  id: "review-jonah",
  status: "pending",
  sourceLine: 3,
  rawName: "Jonah",
  kind: "first_only",
  matchType: "first_only",
  houseNumber: 7,
  house: { id: "house-7", number: 7, name: "River Room" },
  role: "member",
  candidates: [],
  notes: null,
  createdAt: "2026-11-01T08:00:00.000Z",
  resolvedAt: null,
};

function client(items: ReviewItem[], resolveReview?: HouseChurchesClient["resolveReview"]): HouseChurchesClient {
  return {
    listHouses: async () => ({ houses: [], canWrite: true }),
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
    listReview: async () => ({ items }),
    resolveReview:
      resolveReview ??
      (async (itemId) => ({
        item: { ...items.find((item) => item.id === itemId)!, status: "matched", resolvedAt: "2026-11-02T00:00:00.000Z" },
      })),
  };
}

const people: Pick<MissioClient, "listPeople"> = {
  listPeople: async (query) => ({
    rows:
      query?.q?.toLowerCase().includes("elise")
        ? [
            {
              id: "person-elise",
              contactId: "c-elise",
              name: "Elise Navarro",
              campus: "jhb",
              status: "visitor",
              joinedAt: null,
              currentStage: null,
            },
          ]
        : [],
    total: 1,
  }),
};

describe("review queue", () => {
  const roots: Array<ReturnType<typeof render>["root"]> = [];
  const hosts: HTMLElement[] = [];

  afterEach(() => cleanup(roots, hosts));

  function mount(node: ReactNode) {
    const view = render(node);
    roots.push(view.root);
    hosts.push(view.host);
    return view.host;
  }

  it("shows the original line, the house, and a plain reason", async () => {
    const host = mount(<ReviewQueue client={client([family, partial])} people={people} />);
    await settle();
    expect(host.querySelector("[data-testid=review-progress]")?.textContent?.trim()).toBe("1 of 2");
    expect(host.textContent).toContain("Line 12 · The Adler family");
    expect(host.textContent).toContain("see house 4");
    expect(host.textContent).not.toContain("Original line");
    expect(host.textContent).toContain("House 4 · Leader");
    expect(host.textContent).toContain("Family name, not one person");
    expect(host.textContent).toContain("No match found");
    expect(host.textContent).not.toMatch(/Delete|Coming soon/);
  });

  it("links a candidate, advances, then reaches the done state", async () => {
    const bodies: ResolveBody[] = [];
    const host = mount(
      <ReviewQueue
        people={people}
        client={client([family, partial], async (_id, body) => {
          bodies.push(body);
          return { item: { ...family, status: "matched", resolvedAt: "2026-11-02T00:00:00.000Z" } };
        })}
      />
    );
    await settle();
    const usePeter = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Use Peter Adler"));
    expect(usePeter?.textContent).not.toContain("In the people list");
    usePeter?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(bodies[0]).toEqual({ action: "link", contactId: "c-peter" });
    expect(host.querySelector("[data-testid=review-progress]")?.textContent?.trim()).toBe("2 of 2");
    expect(host.textContent).toContain("Line 3 · Jonah");
    expect(host.textContent).toContain("First name only");
    expect(host.textContent).toContain("River Room");
    expect(host.textContent).toContain("House 7 · Member");

    (host.querySelector("[data-testid=review-skip]") as HTMLFormElement).requestSubmit();
    await settle();
    expect(bodies[1]).toEqual({ action: "skip" });
    expect(host.querySelector("[data-testid=review-done]")?.textContent).toContain("Both names are resolved.");
    expect(host.querySelector("[data-testid=review-item]")).toBeNull();
  });

  it("creates a person from the form", async () => {
    const bodies: ResolveBody[] = [];
    const host = mount(
      <ReviewQueue
        people={people}
        client={client([partial], async (_id, body) => {
          bodies.push(body);
          return { item: { ...partial, status: "new", resolvedAt: "2026-11-02T00:00:00.000Z" } };
        })}
      />
    );
    await settle();
    await act(async () => {
      host.querySelector("[data-testid=create-toggle]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    setValue(host.querySelector("[aria-label='First name']") as HTMLInputElement, "Elise");
    setValue(host.querySelector("[aria-label='Last name']") as HTMLInputElement, "Navarro");
    setValue(host.querySelector("[aria-label='Email']") as HTMLInputElement, "elise@example.com");
    await settle();
    (host.querySelector("[data-testid=review-create]") as HTMLFormElement).requestSubmit();
    await settle();
    expect(bodies[0]).toEqual({
      action: "create",
      firstName: "Elise",
      lastName: "Navarro",
      email: "elise@example.com",
    });
    expect(host.querySelector("[data-testid=review-done]")?.textContent).toContain("That name is resolved.");
  });

  it("searches the people list and links that contact", async () => {
    const bodies: ResolveBody[] = [];
    const host = mount(
      <ReviewQueue
        people={people}
        client={client([partial], async (_id, body) => {
          bodies.push(body);
          return { item: { ...partial, status: "matched", resolvedAt: "2026-11-02T00:00:00.000Z" } };
        })}
      />
    );
    await settle();
    setValue(host.querySelector("[aria-label='Search people']") as HTMLInputElement, "Elise");
    await settle();
    (host.querySelector("[data-testid=people-picker]") as HTMLFormElement).requestSubmit();
    await settle();
    const pick = [...host.querySelectorAll("[data-testid=people-results] button")][0] as HTMLButtonElement;
    expect(pick.textContent).toContain("Elise Navarro");
    pick.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(bodies[0]).toEqual({ action: "link", contactId: "c-elise" });
  });

  it("sends a skip note and stays put when the contact already exists", async () => {
    const bodies: ResolveBody[] = [];
    const host = mount(
      <ReviewQueue
        people={people}
        client={client([family, partial], async (_id, body) => {
          bodies.push(body);
          if (body.action === "create") {
            throw new MissioApiError(409, "exists", null, "exists_use_search");
          }
          return { item: { ...family, status: "skipped", resolvedAt: "2026-11-02T00:00:00.000Z" } };
        })}
      />
    );
    await settle();
    setValue(host.querySelector("[aria-label='Skip note']") as HTMLTextAreaElement, "A household, not one person");
    await settle();
    (host.querySelector("[data-testid=review-skip]") as HTMLFormElement).requestSubmit();
    await settle();
    expect(bodies[0]).toEqual({ action: "skip", notes: "A household, not one person" });
    expect(host.textContent).toContain("Jonah");

    await act(async () => {
      host.querySelector("[data-testid=create-toggle]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    setValue(host.querySelector("[aria-label='First name']") as HTMLInputElement, "Jonah");
    await settle();
    (host.querySelector("[data-testid=review-create]") as HTMLFormElement).requestSubmit();
    await settle();
    expect(host.textContent).toContain("Open Missio People, then Add person.");
    expect(host.textContent).not.toContain("Search for them and link them");
    expect(host.querySelector("[data-testid=review-progress]")?.textContent?.trim()).toBe("2 of 2");
    expect(host.querySelector("[data-testid=review-done]")).toBeNull();
  });

  it("shows an empty queue and a no-access state", async () => {
    const empty = mount(<ReviewQueue client={client([])} people={people} />);
    await settle();
    expect(empty.querySelector("[data-testid=review-empty]")?.textContent).toContain("No imported names are waiting.");

    const forbidden = mount(
      <ReviewQueue
        people={people}
        client={{
          ...client([]),
          listReview: async () => {
            throw new MissioApiError(403, "no", null, "forbidden");
          },
        }}
      />
    );
    await settle();
    expect(forbidden.querySelector("[data-testid=missio-no-access]")?.getAttribute("data-status")).toBe("403");
  });

  it("maps every pinned code to fixed copy and never shows the server message", async () => {
    const serverText = "violates foreign key constraint fk_house_church_members";
    const cases: Array<{ status: number; code: string; copy: string; card?: "401" | "403" }> = [
      { status: 400, code: "invalid_input", copy: "Check the details and try again." },
      { status: 400, code: "not_missio_person", copy: "This person isn’t in Missio yet. Add them in Missio People first." },
      { status: 404, code: "not_found", copy: "That couldn’t be found." },
      { status: 409, code: "already_member", copy: "They’re already in this house." },
      { status: 409, code: "already_resolved", copy: "Someone else already sorted this one." },
      { status: 409, code: "membership_not_current", copy: "They’re no longer in this house." },
      { status: 409, code: "member_left_missio", copy: "They’ve left Missio, so they can’t be changed here." },
      { status: 409, code: "ended_at_in_future", copy: "That end date is still in the future." },
      { status: 401, code: "unauthenticated", copy: "Sign in required", card: "401" },
      { status: 403, code: "forbidden", copy: "Pastors only", card: "403" },
      { status: 429, code: "rate_limited", copy: "Too many attempts, try again in 12 seconds" },
      { status: 500, code: "server_error", copy: "Something went wrong on our side. Try again." },
      { status: 500, code: "brand_new_code", copy: "That didn’t work. Try again." },
    ];
    for (const item of cases) {
      const fetchImpl: typeof fetch = async () =>
        new Response(JSON.stringify({ error: serverText, message: serverText, code: item.code }), {
          status: item.status,
          headers: {
            "content-type": "application/json",
            ...(item.code === "rate_limited" ? { "retry-after": "12" } : {}),
          },
        });
      const host = mount(<ReviewQueue client={createHouseChurchesClient(fetchImpl)} people={people} />);
      await settle();
      if (item.card) {
        expect(host.querySelector("[data-testid=missio-no-access]")?.getAttribute("data-status")).toBe(item.card);
      }
      expect(host.textContent).toContain(item.copy);
      expect(document.body.textContent).not.toContain("foreign key");
      expect(document.body.textContent).not.toContain(serverText);
    }
  });
});
