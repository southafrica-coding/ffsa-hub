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
    create: async () => naidoos,
    addAdult: async () => naidoos,
    addChild: async () => naidoos,
    update: async () => naidoos,
    remove: async () => naidoos,
    ...over,
  };
}

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
    const host = mount(<HouseholdCard personId="p-esther" name="Esther Naidoo" client={stub()} people={{ listPeople: async () => ({ rows: [], total: 0 }) }} />);
    await settle();
    expect(host.textContent).toContain("Household · The Naidoos");
    expect(host.textContent).toContain("Adult · husband");
    expect(host.textContent).toContain("Child · born 2018");
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
        people={{ listPeople: async () => ({ rows: [], total: 0 }) }}
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
    expect(document.body.textContent).toContain("Child · born 2021");
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
        people={{ listPeople: async () => ({ rows: [], total: 0 }) }}
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
