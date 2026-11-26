/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Household } from "@/lib/missio/households";
import { cleanup, render, setValue, settle } from "../house-churches/test-render";
import type { HouseholdsClient } from "./client";
import { HouseholdCard } from "./household-card";
import { householdLine, HouseholdsView } from "./households-view";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const naidoos: Household = {
  id: "hh1",
  title: "The Naidoos",
  name: null,
  mainContactId: "c-esther",
  greeting: "Hi Esther & Johan",
  adults: [
    { memberId: "m1", contactId: "c-esther", personId: "p-esther", name: "Esther Naidoo", firstName: "Esther", label: null, main: true, houses: [] },
    {
      memberId: "m2",
      contactId: "c-johan",
      personId: "p-johan",
      name: "Johan Naidoo",
      firstName: "Johan",
      label: "husband",
      main: false,
      houses: [{ id: "h5", number: 5, name: null }],
    },
  ],
  children: [{ memberId: "m3", firstName: "Lia", lastName: "Naidoo", birthYear: 2018 }],
};

function stub(over: Partial<HouseholdsClient> = {}): HouseholdsClient {
  return {
    list: async () => [naidoos],
    forPerson: async () => naidoos,
    forContact: async () => naidoos,
    create: async () => naidoos,
    addAdult: async () => naidoos,
    addChild: async () => naidoos,
    update: async () => naidoos,
    remove: async () => naidoos,
    ...over,
  };
}

// "Today" for children's ages: 1 June 2026 in Johannesburg.
const NOW = new Date("2026-06-01T08:00:00+02:00");
const noPeople = { listPeople: async () => ({ rows: [], total: 0 }) };

const roots: Parameters<typeof cleanup>[0] = [];
const hosts: HTMLElement[] = [];
afterEach(() => cleanup(roots, hosts));
function mount(node: ReactNode) {
  const shown = render(node);
  roots.push(shown.root);
  hosts.push(shown.host);
  return shown.host;
}
const button = (label: string) =>
  [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;

describe("HouseholdCard", () => {
  it("shows the family, the main contact and how family messages open", async () => {
    const host = mount(<HouseholdCard personId="p-esther" name="Esther Naidoo" client={stub()} people={noPeople} now={NOW} />);
    await settle();
    expect(host.textContent).toContain("Household · The Naidoos");
    expect(host.textContent).toContain("Adult · husband");
    expect(host.textContent).toContain("Child · 8 years old");
    expect(host.textContent).not.toContain("born 2018");
    // First name only for children on the card.
    expect(host.querySelector("[data-testid=household-child]")?.textContent).not.toContain("Naidoo");
    expect(host.textContent).toContain("Family messages go once, to Esther: “Hi Esther & Johan”.");
  });

  it("adds a child with only a first name, the year and the family surname", async () => {
    const added: unknown[] = [];
    mount(
      <HouseholdCard
        personId="p-esther"
        name="Esther Naidoo"
        client={stub({
          addChild: async (_id, child) => {
            added.push(child);
            return { ...naidoos, children: [...naidoos.children, { memberId: "m4", firstName: "Sam", lastName: "Naidoo", birthYear: 2021 }] };
          },
        })}
        people={noPeople}
        now={NOW}
      />
    );
    await settle();
    act(() => button("Add a child").click());
    const inputs = [...document.body.querySelectorAll("[data-testid=household-add] input")] as HTMLInputElement[];
    setValue(inputs[0]!, "Sam");
    setValue(inputs[1]!, "2021");
    await settle();
    await act(async () => button("Add Sam").click());
    await settle();
    expect(added).toEqual([{ firstName: "Sam", birthYear: 2021, lastName: "Naidoo" }]);
    expect(document.body.textContent).toContain("Child · 5 years old");
    expect(document.body.querySelector("[data-testid=household-lead]")?.textContent).toBe("Married to Johan · Lia, 8 and Sam, 5");
  });

  it("keeps the child-form help line", async () => {
    mount(<HouseholdCard personId="p-esther" name="Esther Naidoo" client={stub()} people={noPeople} now={NOW} />);
    await settle();
    act(() => button("Add a child").click());
    expect(document.body.textContent).toContain("Only the year. We don’t keep more than we need about children.");
  });

  it("says who they're married to and links to the spouse's profile, not their own", async () => {
    const host = mount(<HouseholdCard personId="p-esther" name="Esther Naidoo" client={stub()} people={noPeople} now={NOW} />);
    await settle();
    const lead = host.querySelector("[data-testid=household-lead]")!;
    expect(lead.textContent).toBe("Married to Johan · Lia, 8");
    const links = [...host.querySelectorAll("a[data-testid=household-person-link]")] as HTMLAnchorElement[];
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Johan", "/missio/people/p-johan"],
      ["Johan Naidoo", "/missio/people/p-johan"],
    ]);
    // Esther's own name isn't a link on her own profile.
    expect(links.some((a) => a.textContent?.includes("Esther"))).toBe(false);
  });

  it("links back to Esther from Johan's profile", async () => {
    const host = mount(<HouseholdCard personId="p-johan" name="Johan Naidoo" client={stub()} people={noPeople} now={NOW} />);
    await settle();
    expect(host.querySelector("[data-testid=household-lead]")?.textContent).toBe("Married to Esther · Lia, 8");
    expect(host.querySelector("a[data-testid=household-person-link]")?.getAttribute("href")).toBe("/missio/people/p-esther");
  });

  it("doesn't say married with three adults, a 'mom', or an adult with no people row", async () => {
    const gran = { memberId: "m5", contactId: "c-gran", personId: "p-gran", name: "Ruth Naidoo", firstName: "Ruth", label: "mom", main: false, houses: [] };
    const three = { ...naidoos, adults: [...naidoos.adults, gran] };
    const host = mount(<HouseholdCard personId="p-esther" name="Esther Naidoo" client={stub({ forPerson: async () => three })} people={noPeople} now={NOW} />);
    await settle();
    expect(host.querySelector("[data-testid=household-lead]")?.textContent).toBe("Lia, 8");
    expect(host.textContent).not.toContain("Married to");
    expect(host.textContent).toContain("Ruth Naidoo");

    cleanup(roots, hosts);
    const withMom = { ...naidoos, adults: [naidoos.adults[0]!, { ...gran }], children: [] };
    const second = mount(<HouseholdCard personId="p-esther" name="Esther Naidoo" client={stub({ forPerson: async () => withMom })} people={noPeople} now={NOW} />);
    await settle();
    expect(second.querySelector("[data-testid=household-lead]")).toBeNull();
    expect(second.querySelector("a[data-testid=household-person-link]")?.getAttribute("href")).toBe("/missio/people/p-gran");

    cleanup(roots, hosts);
    const noRow = { ...naidoos, adults: [naidoos.adults[0]!, { ...naidoos.adults[1]!, personId: null }] };
    const third = mount(<HouseholdCard personId="p-esther" name="Esther Naidoo" client={stub({ forPerson: async () => noRow })} people={noPeople} now={NOW} />);
    await settle();
    expect(third.querySelector("[data-testid=household-lead]")?.textContent).toBe("Married to Johan · Lia, 8");
    expect(third.querySelector("a[data-testid=household-person-link]")).toBeNull();
  });

  it("still takes someone out of the household in edit mode", async () => {
    const removed: string[] = [];
    const host = mount(
      <HouseholdCard
        personId="p-esther"
        name="Esther Naidoo"
        client={stub({
          remove: async (_id, memberId) => {
            removed.push(memberId);
            return { ...naidoos, children: [] };
          },
        })}
        people={noPeople}
        now={NOW}
      />
    );
    await settle();
    act(() => button("Edit").click());
    const takeOutLia = document.body.querySelector("[aria-label='Take Lia out of the household']") as HTMLButtonElement;
    await act(async () => takeOutLia.click());
    await settle();
    expect(removed).toEqual(["m3"]);
    expect(host.querySelector("[data-testid=household-child]")).toBeNull();
    expect(host.querySelector("[data-testid=household-lead]")?.textContent).toBe("Married to Johan");
  });

  it("offers to start a household when there is none", async () => {
    const created: string[] = [];
    const host = mount(
      <HouseholdCard
        personId="p-ayesha"
        name="Ayesha Daniels"
        client={stub({
          forPerson: async () => null,
          create: async (id) => {
            created.push(id);
            return naidoos;
          },
        })}
        people={noPeople}
      />
    );
    await settle();
    expect(host.textContent).toContain("Ayesha isn’t linked to a household yet.");
    await act(async () => button("Add an adult").click());
    await settle();
    expect(created).toEqual(["p-ayesha"]);
    expect(document.body.querySelector("[data-testid=household-add]")).not.toBeNull();
  });
});

describe("HouseholdsView", () => {
  it("lists families with adults, kids and their house", async () => {
    expect(householdLine(naidoos)).toBe("2 adults · 1 kid · House 5");
    const host = mount(<HouseholdsView client={stub()} />);
    await settle();
    expect(host.textContent).toContain("The Naidoos");
    expect(host.textContent).toContain("2 adults · 1 kid · House 5");
  });
});
