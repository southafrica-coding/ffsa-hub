/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextLeader } from "@/lib/missio/next-leaders";
import { readyToMultiply } from "../house-churches/format";
import { cleanup, render, settle } from "../house-churches/test-render";
import { multiplyLine, NextLeadersBoard } from "./board";
import type { NextLeadersClient } from "./client";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const leader = (over: Partial<NextLeader>): NextLeader => ({
  id: "n1",
  virtual: false,
  contactId: "c1",
  personId: "p1",
  name: "Mia Grobler",
  house: { id: "h5", number: 5, name: null },
  trainer: { contactId: "c-e", name: "Esther Naidoo" },
  stage: "spotted",
  note: "Natural host, people gather around her.",
  since: "2026-11-03T08:00:00Z",
  ...over,
});

const roots: Parameters<typeof cleanup>[0] = [];
const hosts: HTMLElement[] = [];
afterEach(() => cleanup(roots, hosts));
function mount(node: ReactNode) {
  const shown = render(node);
  roots.push(shown.root);
  hosts.push(shown.host);
  return shown.host;
}

describe("ready to multiply", () => {
  it("needs a full house and someone ready to lead", () => {
    expect(readyToMultiply({ memberCount: 24, coLeaders: [], readyToLead: 1 })).toBe(true);
    expect(readyToMultiply({ memberCount: 24, coLeaders: [{ contactId: "x", displayName: "X", firstName: null, lastName: null }], readyToLead: 0 })).toBe(false);
    expect(readyToMultiply({ memberCount: 9, coLeaders: [], readyToLead: 1 })).toBe(false);
  });

  it("says which houses can multiply now and which can grow first", () => {
    expect(
      multiplyLine([
        { id: "h5", number: 5, name: null, memberCount: 24, ready: ["Daniel Fourie"] },
        { id: "h4", number: 4, name: null, memberCount: 9, ready: ["Kea Molefe"] },
        { id: "h3", number: 3, name: null, memberCount: 20, ready: [] },
      ])
    ).toBe("1 house can multiply now: House 5 has 24 people and Daniel is ready to lead. House 4 has Kea ready, but only 9 people, so it can grow first.");
  });
});

describe("NextLeadersBoard", () => {
  it("shows the three stages and moves a card along", async () => {
    const moves: unknown[] = [];
    let leaders = [
      leader({}),
      leader({ id: "co:h5:c2", virtual: true, contactId: "c2", name: "Daniel Fourie", stage: "in_training", note: "Co-leading.", since: null }),
    ];
    const client: NextLeadersClient = {
      list: async () => ({ leaders, houses: [{ id: "h5", number: 5, name: null, memberCount: 24, ready: [] }] }),
      nominate: async () => undefined,
      move: async (id, change) => {
        moves.push([id, change]);
        leaders = leaders.map((row) => (row.id === id ? { ...row, stage: change.stage ?? row.stage } : row));
      },
    };
    const host = mount(<NextLeadersBoard client={client} />);
    await settle();
    expect(host.querySelector("[data-testid=nl-spotted]")?.textContent).toContain("Mia Grobler");
    expect(host.querySelector("[data-testid=nl-spotted]")?.textContent).toContain("House 5 · with Esther");
    expect(host.querySelector("[data-testid=nl-spotted]")?.textContent).toContain("Spotted 3 Nov");
    expect(host.querySelector("[data-testid=nl-in_training]")?.textContent).toContain("Daniel Fourie");
    const forward = [...host.querySelectorAll("[data-testid=nl-in_training] button")].find((b) => b.textContent === "Ready to lead →") as HTMLButtonElement;
    await act(async () => forward.click());
    await settle();
    expect(moves).toEqual([["co:h5:c2", { stage: "ready" }]]);
    expect(host.querySelector("[data-testid=nl-ready]")?.textContent).toContain("Daniel Fourie");
  });
});
