/** @vitest-environment happy-dom */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonProfile } from "@/lib/missio/profile";
import { MissioApiError } from "./api";
import { cleanup, render, settle } from "./house-churches/test-render";
import { journeyCopy, PersonProfileView } from "./person-profile";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const profile: PersonProfile = {
  person: { id: "p1", contactId: "c1", name: "Kea Molefe", campus: "potch", status: "active", joinedAt: "2026-03-19", currentStage: null },
  contact: { email: "kea@example.org", phone: "082 555 0142" },
  houses: [
    { membershipId: "m2", houseId: "h4", number: 4, name: null, role: "co_leader", startedAt: "2026-09-01", endedAt: null },
    { membershipId: "m1", houseId: "h2", number: 2, name: "River Room", role: "member", startedAt: "2026-03-19", endedAt: "2026-08-31" },
  ],
  journey: [
    { id: "a", at: "2026-09-01", type: "joined_house", houseId: "h4", number: 4, name: null, role: "co_leader" },
    { id: "b", at: "2026-03-03T09:00:00Z", type: "followup_stage", stage: "contacted" },
    { id: "c", at: "2026-03-01T07:00:00Z", type: "connect_card", visitType: "first_time", wantsHouseChurch: true, wantsPrayer: false },
  ],
};

const noLogin = {
  get: async () => ({ hasLogin: false, roles: [], lastSignInAt: null }),
  set: async () => ({ hasLogin: false, roles: [], lastSignInAt: null }),
};

describe("person profile", () => {
  const roots: Array<ReturnType<typeof render>["root"]> = [];
  const hosts: HTMLElement[] = [];
  afterEach(() => cleanup(roots, hosts));
  function mount(node: ReactNode) {
    const view = render(node);
    roots.push(view.root);
    hosts.push(view.host);
    return view.host;
  }

  it("shows who they are, where they belong and their journey", async () => {
    const host = mount(<PersonProfileView personId="p1" load={async () => profile} access={noLogin} />);
    await settle();
    expect(host.querySelector("h1")?.textContent).toBe("Kea Molefe");
    const belongs = host.querySelector("[data-testid=profile-belongs]") as HTMLElement;
    expect(belongs.textContent).toContain("House 4 · Co-leader");
    expect(belongs.textContent).toContain("Since Sep");
    expect(belongs.querySelector("a")?.getAttribute("href")).toBe("/missio/house-churches/h4");
    const actions = [...host.querySelectorAll("[data-testid=profile-actions] a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(actions).toEqual([
      ["Call", "tel:0825550142"],
      ["WhatsApp", "https://wa.me/27825550142"],
      ["Email", "mailto:kea@example.org"],
    ]);
    expect(host.querySelector("[data-testid=profile-contact]")?.textContent).toContain("082 555 0142");
    const steps = [...host.querySelectorAll("[data-testid=profile-journey] li")];
    expect(steps).toHaveLength(3);
    expect(steps[0].textContent).toContain("Became co-leader of House 4");
    expect(steps[2].textContent).toContain("First time · would like a house church");

    const houses = [...host.querySelectorAll("[data-testid=profile-journey] button")].find((b) => b.textContent === "Houses");
    houses?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(host.querySelectorAll("[data-testid=profile-journey] li")).toHaveLength(1);
    expect(houses?.getAttribute("aria-pressed")).toBe("true");
  });

  it("says so when the person can't be found", async () => {
    const host = mount(
      <PersonProfileView
        personId="nope"
        access={noLogin}
        load={async () => {
          throw new MissioApiError(404, "x", null, "not_found");
        }}
      />
    );
    await settle();
    expect(host.querySelector("[role=alert]")).not.toBeNull();
    expect(host.querySelector("h1")).toBeNull();
  });

  it("writes each kind of step in plain words", () => {
    expect(journeyCopy({ id: "x", at: "2026-01-01", type: "added" }).title).toBe("Added to Missio");
    expect(journeyCopy({ id: "x", at: "2026-01-01", type: "left_house", houseId: "h", number: 2, name: null, role: "member" }).title).toBe("Left House 2");
    expect(journeyCopy({ id: "x", at: "2026-01-01", type: "followup_stage", stage: "joined" })).toEqual({ title: "Follow-up closed", detail: "Joined a house church" });
  });

  it("lets a pastor make someone with a login a coach, and explains when there's no login", async () => {
    const calls: Array<[string, boolean]> = [];
    let roles: string[] = ["house_church_leader"];
    const host = mount(
      <PersonProfileView
        personId="p1"
        load={async () => profile}
        access={{
          get: async () => ({ hasLogin: true, roles, lastSignInAt: null }),
          set: async (_id, role, on) => {
            calls.push([role, on]);
            roles = on ? [...roles, role] : roles.filter((item) => item !== role);
            return { hasLogin: true, roles, lastSignInAt: null };
          },
        }}
      />
    );
    await settle();
    const card = host.querySelector("[data-testid=profile-access]") as HTMLElement;
    const boxes = [...card.querySelectorAll("input[type=checkbox]")] as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([false, true]);
    boxes[0]!.click();
    await settle();
    expect(calls).toEqual([["coach", true]]);
    expect(([...card.querySelectorAll("input[type=checkbox]")] as HTMLInputElement[])[0]!.checked).toBe(true);

    const other = mount(<PersonProfileView personId="p1" load={async () => profile} access={noLogin} />);
    await settle();
    expect(other.querySelector("[data-testid=profile-access]")?.textContent).toContain("doesn’t have a Hub login yet");
  });
});
