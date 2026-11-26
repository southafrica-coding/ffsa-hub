/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MissioApiError } from "../api";
import { cleanup, render, settle } from "../house-churches/test-render";
import type { MissioMe } from "../types-shim";
import { MissioViewerProvider } from "../viewer";
import { EMPTY_SUGGESTIONS, FamilySuggestionsEntry, FamilySuggestionsList, ProfileCoupleSuggestion } from "./couple-suggestions";
import type { HouseholdSuggestion, SuggestionsClient } from "./suggestions-client";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Made-up people only.
const pair: HouseholdSuggestion = {
  id: "s1",
  a: { personId: "p-riley", firstName: "Riley" },
  b: { personId: "p-gideon", firstName: "Gideon" },
  houseNumber: 6,
  link: "new",
};

const pastor: MissioMe = { orgs: [{ id: "org-missio", slug: "missio", name: "Missio" }], rolesByOrg: { missio: ["pastor"] }, currentOrg: "missio" };
const leader: MissioMe = {
  orgs: [{ id: "org-missio", slug: "missio", name: "Missio" }],
  rolesByOrg: { missio: ["house_church_leader"] },
  currentOrg: "missio",
};

function stub(over: Partial<SuggestionsClient> = {}): SuggestionsClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    list: async () => (calls.push("list"), [pair]),
    forPerson: async (id) => (calls.push(`forPerson:${id}`), [pair]),
    accept: async (id, options) => (calls.push(`accept:${id}:${options?.addToExisting ? "existing" : "-"}`), { kind: "linked", household: null }),
    dismiss: async (id) => void calls.push(`dismiss:${id}`),
    ...over,
  };
}

const roots: Parameters<typeof cleanup>[0] = [];
const hosts: HTMLElement[] = [];
afterEach(() => cleanup(roots, hosts));
function mount(node: ReactNode, me: MissioMe = pastor) {
  const shown = render(<MissioViewerProvider me={me}>{node}</MissioViewerProvider>);
  roots.push(shown.root);
  hosts.push(shown.host);
  return shown.host;
}
const button = (label: string) =>
  [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

describe("profile banner", () => {
  it("names this person first and asks before linking", async () => {
    const host = mount(<ProfileCoupleSuggestion personId="p-gideon" client={stub()} />);
    await settle();
    const banner = host.querySelector("[data-testid=couple-suggestion]");
    expect(banner?.textContent).toContain(
      "Gideon and Riley were listed together on the house church sheet. Link them as a household?"
    );
    expect(banner?.textContent).toContain("Family suggestion · House 6");
    expect(button("Link household")).toBeTruthy();
    expect(button("Not a couple")).toBeTruthy();
    // The other person isn't a link on the profile banner, and no contact details are shown.
    expect(banner?.querySelectorAll("a").length).toBe(0);
  });

  it("Link calls accept, then the household card reloads", async () => {
    const client = stub();
    const onLinked = vi.fn();
    mount(<ProfileCoupleSuggestion personId="p-gideon" client={client} onLinked={onLinked} />);
    await settle();
    await act(async () => button("Link household")!.click());
    await settle();
    expect(client.calls).toContain("accept:s1:-");
    expect(onLinked).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Linked. Gideon and Riley are one household now.");
  });

  it("Not a couple dismisses and doesn't reload the household", async () => {
    const client = stub();
    const onLinked = vi.fn();
    mount(<ProfileCoupleSuggestion personId="p-gideon" client={client} onLinked={onLinked} />);
    await settle();
    await act(async () => button("Not a couple")!.click());
    await settle();
    expect(client.calls).toContain("dismiss:s1");
    expect(client.calls.some((call) => call.startsWith("accept"))).toBe(false);
    expect(onLinked).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("They won’t be suggested again.");
  });

  it("asks a second time before adding someone to a household that exists", async () => {
    let first = true;
    const client = stub({
      accept: async (id, options) => {
        client.calls.push(`accept:${id}:${options?.addToExisting ? "existing" : "-"}`);
        if (first) {
          first = false;
          return { kind: "confirm", householdTitle: "The Example family", joiningPersonId: "p-riley" };
        }
        return { kind: "linked", household: null };
      },
    });
    const onLinked = vi.fn();
    mount(<ProfileCoupleSuggestion personId="p-gideon" client={client} onLinked={onLinked} />);
    await settle();
    await act(async () => button("Link household")!.click());
    await settle();
    expect(document.body.querySelector("[data-testid=couple-suggestion-confirm]")?.textContent).toBe(
      "Riley would join The Example family. Nobody is taken out of it, and no children are added."
    );
    expect(onLinked).not.toHaveBeenCalled();
    await act(async () => button("Add Riley")!.click());
    await settle();
    expect(client.calls).toEqual(["forPerson:p-gideon", "accept:s1:-", "accept:s1:existing"]);
    expect(onLinked).toHaveBeenCalledTimes(1);
  });

  it("explains, and offers no Link, when they're each in a different household", async () => {
    mount(<ProfileCoupleSuggestion personId="p-gideon" client={stub({ forPerson: async () => [{ ...pair, link: "separate" }] })} />);
    await settle();
    expect(document.body.textContent).toContain("They’re each in a different household, so this can’t link them.");
    expect(button("Link household")).toBeUndefined();
    expect(button("Not a couple")).toBeTruthy();
  });

  it("shows fixed copy when Link fails", async () => {
    mount(
      <ProfileCoupleSuggestion
        personId="p-gideon"
        client={stub({
          accept: async () => {
            throw new MissioApiError(409, "", null, "both_in_households");
          },
        })}
      />
    );
    await settle();
    await act(async () => button("Link household")!.click());
    await settle();
    expect(document.body.querySelector("[role=alert]")?.textContent).toBe(
      "They’re each in a different household. Open their profiles to sort that out."
    );
  });

  it("renders nothing without a pending suggestion", async () => {
    const host = mount(<ProfileCoupleSuggestion personId="p-gideon" client={stub({ forPerson: async () => [] })} />);
    await settle();
    expect(host.textContent).toBe("");
  });

  it("is pastors only: a house leader never asks", async () => {
    const client = stub();
    const host = mount(<ProfileCoupleSuggestion personId="p-gideon" client={client} />, leader);
    await settle();
    expect(host.textContent).toBe("");
    expect(client.calls).toEqual([]);
  });
});

describe("Family suggestions list", () => {
  it("lists pending pairs with links to both profiles", async () => {
    const host = mount(<FamilySuggestionsList client={stub()} />);
    await settle();
    expect(host.querySelector("h1")?.textContent).toBe("Family suggestions");
    const card = host.querySelector("[data-testid=couple-suggestion]")!;
    expect(card.textContent).toContain("Riley and Gideon were listed together on the house church sheet. Link them as a household?");
    expect([...card.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["/missio/people/p-riley", "/missio/people/p-gideon"]);
  });

  it("says so honestly when there are none", async () => {
    const host = mount(<FamilySuggestionsList client={stub({ list: async () => [] })} />);
    await settle();
    expect(host.querySelector("[data-testid=family-suggestions-empty]")?.textContent).toBe(EMPTY_SUGGESTIONS);
    expect(EMPTY_SUGGESTIONS).toBe("No pending suggestions. A pastor can load them from the house church sheet later.");
  });

  it("is pastors only", async () => {
    const client = stub();
    const host = mount(<FamilySuggestionsList client={client} />, leader);
    await settle();
    expect(host.textContent).toContain("Pastors only.");
    expect(host.querySelector("[data-testid=couple-suggestion]")).toBeNull();
    expect(client.calls).toEqual([]);
  });

  it("the People link shows a count only when there are pending pairs", async () => {
    const host = mount(<FamilySuggestionsEntry client={stub()} />);
    await settle();
    const link = host.querySelector("[data-testid=family-suggestions-entry]")!;
    expect(link.getAttribute("href")).toBe("/missio/people/suggestions");
    expect(link.textContent).toBe("Family suggestions1");
    cleanup(roots, hosts);
    const none = mount(<FamilySuggestionsEntry client={stub({ list: async () => [] })} />);
    await settle();
    expect(none.querySelector("[data-testid=family-suggestions-entry]")?.textContent).toBe("Family suggestions");
    cleanup(roots, hosts);
    const hidden = mount(<FamilySuggestionsEntry client={stub()} />, leader);
    await settle();
    expect(hidden.textContent).toBe("");
  });
});
