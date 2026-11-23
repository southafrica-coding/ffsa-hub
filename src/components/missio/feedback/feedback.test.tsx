/** @vitest-environment happy-dom */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { cleanup, render } from "../house-churches/test-render";
import type { HouseChurchesClient } from "../house-churches/client";
import { FeedbackBars, FeedbackHistory } from "./history";
import { MissioViewerProvider } from "../viewer";
import type { MissioMe } from "../types-shim";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("weekly feedback", () => {
  const roots: Array<ReturnType<typeof render>["root"]> = [];
  const hosts: HTMLElement[] = [];
  afterEach(() => cleanup(roots, hosts));
  function mount(node: ReactNode) {
    const view = render(node);
    roots.push(view.root);
    hosts.push(view.host);
    return view.host;
  }

  it("draws a missed week as a gap, never a zero", () => {
    const host = mount(
      <FeedbackBars
        now={new Date("2026-11-19T12:00:00Z")}
        entries={[
          { meetingDate: "2026-11-18", attendance: 22, mood: "great", newNames: [], prayer: null, notes: null, submittedAt: "" },
          { meetingDate: "2026-11-04", attendance: 18, mood: "okay", newNames: [], prayer: null, notes: null, submittedAt: "" },
        ]}
      />
    );
    const bars = host.querySelector("[role=img]") as HTMLElement;
    expect(bars.getAttribute("aria-label")).toBe("2 of the last 12 weeks reported");
    expect(bars.children).toHaveLength(12);
    const last = [...bars.children].slice(-3).map((el) => (el as HTMLElement).style.height);
    expect(last[0]).not.toBe("");
    expect(last[1]).toBe("");
    expect(last[2]).not.toBe("");
  });

  it("switches between 4 weeks, 12 weeks and a year, asking the route for that many weeks", async () => {
    const asked: number[] = [];
    const client = {
      feedbackHistory: async (weeks = 12) => {
        asked.push(weeks);
        return {
          since: "2026-01-01",
          houses: [
            {
              houseId: "h5",
              number: 5,
              name: null,
              meetingDay: "wednesday",
              coaches: ["Thandi Zulu"],
              entries: [{ meetingDate: "2026-11-18", attendance: 22, mood: "great", newNames: ["Thabo"], prayer: null, notes: null, submittedAt: "" }],
            },
          ],
        };
      },
    } as unknown as HouseChurchesClient;
    const host = mount(<FeedbackHistory client={client} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(asked).toEqual([12]);
    const range = host.querySelector("[data-testid=feedback-range]") as HTMLElement;
    const buttons = [...range.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["4 weeks", "12 weeks", "Year"]);
    expect(buttons[1]?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      buttons[2]?.click();
      await Promise.resolve();
    });
    expect(asked.at(-1)).toBe(52);
    expect(host.querySelector("[aria-label='1 of the last 52 weeks reported']")?.children).toHaveLength(52);
    expect(host.textContent).toContain("new in the last year");

    await act(async () => {
      buttons[0]?.click();
      await Promise.resolve();
    });
    expect(asked.at(-1)).toBe(4);
    expect(host.querySelector("[aria-label='1 of the last 4 weeks reported']")?.children).toHaveLength(4);
  });

  function historyClient() {
    return {
      feedbackHistory: async () => ({
        since: "2026-01-01",
        houses: [
          {
            houseId: "h5",
            number: 5,
            name: null,
            meetingDay: "wednesday",
            coaches: ["Thandi Zulu"],
            entries: [{ meetingDate: "2026-11-18", attendance: 22, mood: "great", newNames: [], prayer: null, notes: null, submittedAt: "" }],
          },
        ],
      }),
    } as unknown as HouseChurchesClient;
  }

  async function settle() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function detailOf(host: HTMLElement) {
    return host.querySelector("[data-testid=feedback-detail]") as HTMLElement;
  }

  it("Weekly feedback has one Copy public link and Send on WhatsApp, and no per-house link", async () => {
    const host = mount(<FeedbackHistory client={historyClient()} />);
    await settle();
    const block = host.querySelector("[data-testid=public-feedback-link]") as HTMLElement;
    expect(block).not.toBeNull();
    expect(host.querySelectorAll("[data-testid=public-feedback-copy]")).toHaveLength(1);
    const copy = block.querySelector("[data-testid=public-feedback-copy]") as HTMLButtonElement;
    expect(copy.textContent).toBe("Copy public link");
    expect(block.querySelector("[data-testid=public-feedback-url]")?.textContent).toMatch(/\/f\/missio-weekly-feedback$/);
    const wa = block.querySelector("[data-testid=public-feedback-whatsapp]") as HTMLAnchorElement;
    expect(wa.textContent).toBe("Send on WhatsApp");
    const text = decodeURIComponent(wa.getAttribute("href") ?? "");
    expect(text).toContain("https://wa.me/?text=");
    expect(text).toContain("/f/missio-weekly-feedback");
    expect(text).toContain("Pick your house church");
    expect(text).not.toContain("/serve/missio/feedback/");

    // The picked house: Fill in this week stays (signed in, knows the house); no token link, no rotate.
    const detail = detailOf(host);
    const fill = detail.querySelector("[data-testid=feedback-fill]") as HTMLAnchorElement;
    expect(fill.textContent).toBe("Fill in this week");
    expect(fill.getAttribute("href")).toBe("/missio-feedback/h5");
    expect(host.querySelector("[data-testid=feedback-copy]")).toBeNull();
    expect(host.querySelector("[data-testid=feedback-rotate]")).toBeNull();
    expect(host.querySelector("[data-testid=feedback-whatsapp]")).toBeNull();
    expect(host.textContent).not.toContain("Copy the leader");
    expect(host.textContent).not.toContain("Make a new link");
  });

  it("Copy public link copies the absolute /f/missio-weekly-feedback URL", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (t: string) => void written.push(t) },
    });
    const host = mount(<FeedbackHistory client={historyClient()} />);
    await settle();
    await act(async () => {
      (host.querySelector("[data-testid=public-feedback-copy]") as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(written).toEqual([`${window.location.origin}/f/missio-weekly-feedback`]);
    expect(host.querySelector("[role=status]")?.textContent).toContain("Link copied");
  });

  it("is the same for pastors, coaches and leaders: nobody gets a per-house link here", async () => {
    const me = (roles: string[]) =>
      ({ currentOrg: "missio", orgs: [], rolesByOrg: { missio: roles } }) as unknown as MissioMe;
    for (const roles of [["pastor"], ["coach"], ["house_church_leader"]]) {
      const host = mount(
        <MissioViewerProvider me={me(roles)}>
          <FeedbackHistory client={historyClient()} />
        </MissioViewerProvider>
      );
      await settle();
      expect(host.querySelector("[data-testid=public-feedback-copy]")).not.toBeNull();
      expect(host.querySelector("[data-testid=feedback-copy]")).toBeNull();
      expect(host.querySelector("[data-testid=feedback-rotate]")).toBeNull();
    }
  });
});
