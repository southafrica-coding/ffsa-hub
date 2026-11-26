/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VolunteersSnapshot, VolunteerTeam } from "@/lib/missio/availability/service";
import { VolunteersBoard } from "./volunteers-board";
import type { VolunteersClient } from "./client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function team(id: string, name: string): VolunteerTeam {
  return { id, name, leaders: [], members: [] };
}

function snapshot(teams: VolunteerTeam[]): VolunteersSnapshot {
  return { teams, requests: [], selectedRequestId: null, grid: [], unansweredPeople: 0 };
}

function fakeClient(loads: VolunteersSnapshot[]) {
  let index = 0;
  const addStarterTeams = vi.fn(async () => ({
    added: ["Worship", "Kids", "Welcome", "Production", "Hospitality"],
    alreadyPresent: ["Sound"],
  }));
  const unused = async () => {
    throw new Error("unused");
  };
  const client: VolunteersClient = {
    load: vi.fn(async () => loads[Math.min(index++, loads.length - 1)]),
    createRequest: unused,
    createTeam: unused,
    addStarterTeams,
    renameTeam: unused,
    deleteTeam: unused,
    addMember: unused,
    removeMember: unused,
    addLeader: unused,
    removeLeader: unused,
    copyLink: unused,
    resetLink: unused,
    nudge: unused,
    searchPeople: async () => [],
  };
  return { client, addStarterTeams };
}

const roots: Root[] = [];
const hosts: HTMLElement[] = [];

async function render(client: VolunteersClient) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  hosts.push(host);
  await act(async () => {
    root.render(<VolunteersBoard client={client} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return host;
}

const starterButton = (host: HTMLElement) =>
  [...host.querySelectorAll("button")].find((button) => button.textContent === "Add starter teams");

afterEach(() => {
  while (roots.length) act(() => roots.pop()?.unmount());
  while (hosts.length) hosts.pop()?.remove();
});

describe("Add starter teams", () => {
  it("is offered when teams are missing, and isn't run on load", async () => {
    const { client, addStarterTeams } = fakeClient([snapshot([])]);
    const host = await render(client);
    expect(host.querySelector("[data-testid=starter-teams]")?.textContent).toContain(
      "Sound, Worship, Kids, Welcome, Production, Hospitality"
    );
    expect(starterButton(host)).toBeTruthy();
    expect(addStarterTeams).not.toHaveBeenCalled();
  });

  it("lists only the missing names, calls the endpoint once on a tap, then hides when all six exist", async () => {
    const all = ["Sound", "Worship", "Kids", "Welcome", "Production", "Hospitality"].map((name, i) => team(`t${i}`, name));
    const { client, addStarterTeams } = fakeClient([snapshot([team("t0", "sound")]), snapshot(all)]);
    const host = await render(client);
    const block = host.querySelector("[data-testid=starter-teams]");
    expect(block?.textContent).toContain("Still to add: Worship, Kids, Welcome, Production, Hospitality.");
    expect(block?.textContent).not.toContain("Sound,");

    await act(async () => {
      starterButton(host)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(addStarterTeams).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Added Worship, Kids, Welcome, Production, Hospitality. Already here: Sound.");
    expect(host.querySelector("[data-testid=starter-teams]")).toBeNull();
    expect(starterButton(host)).toBeUndefined();
  });

  it("isn't shown when the org already has all six (any case)", async () => {
    const names = ["SOUND", "Worship", " kids", "Welcome", "Production", "Hospitality"];
    const { client } = fakeClient([snapshot(names.map((name, i) => team(`t${i}`, name)))]);
    const host = await render(client);
    expect(starterButton(host)).toBeUndefined();
  });
});
