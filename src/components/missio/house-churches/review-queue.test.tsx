/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MissioApiError } from "../api";
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
    searchReviewContacts,
    resolveReview:
      resolveReview ??
      (async (itemId) => ({
        item: { ...items.find((item) => item.id === itemId)!, status: "matched", resolvedAt: "2026-11-02T00:00:00.000Z" },
      })),
  };
}

const searchReviewContacts: HouseChurchesClient["searchReviewContacts"] = async (q) => ({
  matches: q.toLowerCase().includes("elise")
    ? [
        {
          contactId: "c-elise",
          displayName: "Elise Navarro",
          firstName: "Elise",
          lastName: "Navarro",
          hint: "e***@example.org · *** *** 4410",
          inMissio: false,
        },
        {
          contactId: "c-elise-2",
          displayName: "Elise Brandt",
          firstName: "Elise",
          lastName: "Brandt",
          orgPersonId: "person-elise-2",
          inMissio: true,
        },
      ]
    : [],
});

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
    const host = mount(<ReviewQueue client={client([family, partial])} />);
    await settle();
    expect(host.querySelector("[data-testid=review-progress]")?.textContent?.trim()).toBe("1 of 2");
    expect(host.textContent).toContain("Line 12 · The Adler family");
    expect(host.textContent).toContain("see house 4");
    expect(host.textContent).not.toContain("Original line");
    expect(host.textContent).toContain("House 4 · Leader");
    expect(host.textContent).toContain("Family name, not one person");
    expect(host.textContent).toContain("No exact match");
    expect(host.textContent).not.toContain("No match found");
    expect(host.textContent).not.toMatch(/Delete|Coming soon/);
  });

  it("links a candidate, advances, then reaches the done state", async () => {
    const bodies: ResolveBody[] = [];
    const host = mount(
      <ReviewQueue
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
    // Stays on the name so a spouse can be added, and says who went in.
    expect(host.querySelector("[data-testid=review-progress]")?.textContent?.trim()).toBe("1 of 2");
    expect(host.querySelector("[data-testid=review-added]")?.textContent).toContain("Peter Adler");
    expect(host.querySelector("[data-testid=review-skip]")).toBeNull();
    expect(document.activeElement?.id).toBe("review-next");
    const again = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Use Peter Adler"));
    again?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(bodies[1]).toEqual({ action: "link", contactId: "c-peter", also: true });
    bodies.length = 1;
    expect(host.querySelector("#review-next")?.textContent?.trim()).toBe("Next name");
    host.querySelector("#review-next")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
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
    expect(host.querySelector("[data-testid=review-added]")?.textContent).toContain("Elise Navarro");
    expect((host.querySelector("[aria-label='First name']") as HTMLInputElement).value).toBe("");
    expect(host.querySelector("#review-next")?.textContent?.trim()).toBe("Done");
    host.querySelector("#review-next")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(host.querySelector("[data-testid=review-done]")?.textContent).toContain("That name is resolved.");
  });

  it("searches every contact, shows a masked hint, and links the pick", async () => {
    const bodies: ResolveBody[] = [];
    const host = mount(
      <ReviewQueue
        client={client([partial], async (_id, body) => {
          bodies.push(body);
          return { item: { ...partial, status: "matched", resolvedAt: "2026-11-02T00:00:00.000Z" } };
        })}
      />
    );
    await settle();
    const picker = host.querySelector("[data-testid=people-picker]") as HTMLElement;
    const search = picker.querySelector("input") as HTMLInputElement;
    const label = picker.querySelector("label");
    expect(label?.getAttribute("for")).toBe(search.id);
    expect(label?.textContent).toBe("Name");
    expect(search.getAttribute("placeholder")).toBe("First or last name");
    const searchButton = host.querySelector("[data-testid=people-picker] button[type=submit]") as HTMLButtonElement;
    expect(searchButton.textContent?.trim()).toBe("Search");
    setValue(search, "Elise");
    await settle();
    (host.querySelector("[data-testid=people-picker]") as HTMLFormElement).requestSubmit();
    await settle();
    const pick = [...host.querySelectorAll("[data-testid=people-results] button")][0] as HTMLButtonElement;
    expect(pick.textContent).toContain("Elise Navarro");
    expect(pick.textContent).toContain("e***@example.org · *** *** 4410 · Not in Missio yet");
    const second = [...host.querySelectorAll("[data-testid=people-results] button")][1] as HTMLButtonElement;
    expect(second.textContent).toContain("Already in Missio");
    expect(host.textContent).toContain("Looks through every contact in the Hub, not only Missio.");
    pick.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(bodies[0]).toEqual({ action: "link", contactId: "c-elise" });
  });

  it("sends a skip note and stays put when the contact already exists", async () => {
    const bodies: ResolveBody[] = [];
    const host = mount(
      <ReviewQueue
        client={client([family, partial], async (_id, body) => {
          bodies.push(body);
          if (body.action === "create") {
            throw new MissioApiError(409, "exists", null, "not_missio_person");
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
    setValue(host.querySelector("[aria-label='Last name']") as HTMLInputElement, "Reed");
    await settle();
    (host.querySelector("[data-testid=review-create]") as HTMLFormElement).requestSubmit();
    await settle();
    expect(host.textContent).toContain(
      "That didn’t match a new person. If they are already in the Hub, find them under Search everyone and link them."
    );
    expect(document.activeElement).toBe(host.querySelector("#review-action-error"));
    expect(host.querySelector("[data-testid=review-progress]")?.textContent?.trim()).toBe("2 of 2");
    expect(host.querySelector("[data-testid=review-done]")).toBeNull();
  });

  it("names who a refused create collided with and links them in one tap", async () => {
    const bodies: ResolveBody[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (!String(url).includes("/resolve")) {
        return new Response(JSON.stringify({ items: [partial] }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body)) as ResolveBody;
      bodies.push(body);
      if (body.action === "create") {
        return new Response(
          JSON.stringify({
            error: "x",
            code: "not_missio_person",
            matches: [
              {
                contactId: "c-matt",
                displayName: "Matt Gibson",
                firstName: "Matt",
                lastName: "Gibson",
                hint: "m***@example.org · *** *** 0960",
                inMissio: false,
              },
            ],
          }),
          { status: 400 }
        );
      }
      return new Response(JSON.stringify({ item: { ...partial, status: "matched" } }), { status: 200 });
    }) as unknown as typeof fetch;
    const host = mount(<ReviewQueue client={createHouseChurchesClient(fetchImpl)} />);
    await settle();
    await act(async () => {
      host.querySelector("[data-testid=create-toggle]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    setValue(host.querySelector("[aria-label='First name']") as HTMLInputElement, "Matthew");
    setValue(host.querySelector("[aria-label='Phone']") as HTMLInputElement, "0722930960");
    await settle();
    (host.querySelector("[data-testid=review-create]") as HTMLFormElement).requestSubmit();
    await settle();
    expect(host.textContent).toContain("already belongs to someone in the Hub");
    const link = host.querySelector("[data-testid=review-existing] button") as HTMLButtonElement;
    expect(link.textContent).toContain("Link Matt Gibson");
    expect(link.textContent).toContain("*** *** 0960 · Not in Missio yet");
    const rename = host.querySelector("[data-testid=review-link-rename]") as HTMLButtonElement;
    expect(rename.textContent).toContain("Link and rename to Matthew");
    rename.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(bodies.at(-1)).toEqual({ action: "link", contactId: "c-matt", rename: { firstName: "Matthew" } });
    expect(host.querySelector("[data-testid=review-existing]")).toBeNull();
    expect(host.querySelector("[data-testid=review-added]")?.textContent).toContain("Matthew");
  });

  it("creates from a name alone, and asks first when the name is already in the Hub", async () => {
    const bodies: ResolveBody[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (!String(url).includes("/resolve")) {
        return new Response(JSON.stringify({ items: [partial] }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body)) as ResolveBody;
      bodies.push(body);
      if (body.action === "create" && !body.allowDuplicate) {
        return new Response(
          JSON.stringify({
            error: "x",
            code: "not_missio_person",
            matches: [{ contactId: "c-j", displayName: "Josia Muhongo", firstName: "Josia", lastName: "Muhongo", inMissio: false }],
          }),
          { status: 409 }
        );
      }
      return new Response(JSON.stringify({ item: { ...partial, status: "new" } }), { status: 200 });
    }) as unknown as typeof fetch;
    const host = mount(<ReviewQueue client={createHouseChurchesClient(fetchImpl)} />);
    await settle();
    await act(async () => {
      host.querySelector("[data-testid=create-toggle]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).toContain("Email and phone are optional.");
    setValue(host.querySelector("[aria-label='First name']") as HTMLInputElement, "Josia");
    await settle();
    (host.querySelector("[data-testid=review-create]") as HTMLFormElement).requestSubmit();
    await settle();
    expect(host.textContent).toContain("Add a last name, or an email or phone number.");
    expect(bodies).toHaveLength(0);

    setValue(host.querySelector("[aria-label='Last name']") as HTMLInputElement, "Muhongo");
    await settle();
    (host.querySelector("[data-testid=review-create]") as HTMLFormElement).requestSubmit();
    await settle();
    expect(bodies[0]).toEqual({ action: "create", firstName: "Josia", lastName: "Muhongo" });
    expect(host.textContent).toContain("Someone with that name is already in the Hub");
    expect(host.querySelector("[data-testid=review-link-rename]")).toBeNull();
    const anyway = host.querySelector("[data-testid=review-create-anyway]") as HTMLButtonElement;
    expect(anyway.textContent).toContain("No, create a new Josia Muhongo");
    anyway.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(bodies[1]).toEqual({ action: "create", firstName: "Josia", lastName: "Muhongo", allowDuplicate: true });
    expect(host.querySelector("[data-testid=review-added]")?.textContent).toContain("Josia Muhongo");
  });

  it("shows an empty queue and a no-access state", async () => {
    const empty = mount(<ReviewQueue client={client([])} />);
    await settle();
    expect(empty.querySelector("[data-testid=review-empty]")?.textContent).toContain("No imported names are waiting.");

    const forbidden = mount(
      <ReviewQueue
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

  it("keeps the notice when the last name was already sorted", async () => {
    const serverText = "This row is already resolved.";
    const host = mount(
      <ReviewQueue
        client={client([family], async () => {
          throw new MissioApiError(409, serverText, null, "already_resolved");
        })}
      />
    );
    await settle();
    (host.querySelector("[data-testid=review-skip]") as HTMLFormElement).requestSubmit();
    await settle();
    await settle();
    expect(host.textContent).toContain("No names left to review.");
    expect(host.textContent).toContain("Someone else already sorted this one.");
    expect(host.textContent).not.toContain("All 0");
    expect(host.textContent).not.toContain(serverText);
    expect(document.activeElement).toBe(host.querySelector("#review-action-error"));
  });

  it("shows fixed field copy and never the database text inside fieldErrors", async () => {
    const dbText = "violates foreign key constraint fk_house_church_members";
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: dbText,
          message: dbText,
          code: "invalid_input",
          fieldErrors: { contactId: dbText, mystery: "duplicate key value violates unique constraint" },
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    const host = mount(<ReviewQueue client={createHouseChurchesClient(fetchImpl)} />);
    await settle();
    expect(host.textContent).toContain("Pick someone from Missio.");
    expect(host.textContent).toContain("Check this field.");
    expect(document.body.textContent).not.toContain("foreign key");
    expect(document.body.textContent).not.toContain("duplicate key");
    expect(document.body.textContent).not.toContain(dbText);
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
      const host = mount(<ReviewQueue client={createHouseChurchesClient(fetchImpl)} />);
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
