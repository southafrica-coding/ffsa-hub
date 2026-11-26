/** @vitest-environment happy-dom */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonProfile } from "@/lib/missio/profile";
import { cleanup, render, settle } from "./house-churches/test-render";
import { PersonCardDialog } from "./person-card";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const profile: PersonProfile = {
  person: { id: "p1", contactId: "c1", name: "Heinrich Botha", campus: "potch", status: "active", joinedAt: null, currentStage: null },
  contact: { email: "heinrich@example.org", phone: "+27 780198744" },
  houses: [{ membershipId: "m1", houseId: "h19", number: 19, name: null, role: "leader", startedAt: "2026-11-19", endedAt: null }],
  journey: [
    { id: "a", at: "2026-11-19T10:00:00Z", type: "added" },
    { id: "b", at: "2026-11-19", type: "joined_house", houseId: "h19", number: 19, name: null, role: "leader" },
  ],
};

describe("person card", () => {
  const roots: Array<ReturnType<typeof render>["root"]> = [];
  const hosts: HTMLElement[] = [];
  afterEach(() => cleanup(roots, hosts));

  it("shows the person's details over the page, with a link to the full profile", async () => {
    const closed = vi.fn();
    const view = render(
      <PersonCardDialog
        personId="p1"
        name="Heinrich Botha"
        onClose={closed}
        load={async () => profile}
        access={{
          get: async () => ({ hasLogin: false, roles: [], lastSignInAt: null }),
          set: async () => ({ hasLogin: false, roles: [], lastSignInAt: null }),
        }}
      />
    );
    roots.push(view.root);
    hosts.push(view.host);
    await settle();
    const card = document.body.querySelector("[data-testid=person-card]") as HTMLElement;
    expect(card.textContent).toContain("Heinrich Botha");
    expect(card.textContent).toContain("House 19 · Leader");
    expect(card.textContent).toContain("Became leader of House 19");
    expect(card.querySelector("a[href='tel:+27780198744']")?.textContent).toBe("Call");
    expect(card.querySelector("a[href='/missio/people/p1']")?.textContent).toBe("Open full profile");
    expect(card.querySelector("[data-testid=profile-access]")).toBeTruthy();
    const close = [...card.querySelectorAll("button")].find((b) => b.textContent === "Close") as HTMLButtonElement;
    close.click();
    expect(closed).toHaveBeenCalled();
  });
});
