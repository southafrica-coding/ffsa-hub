/** @vitest-environment happy-dom */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { cleanup, render } from "../house-churches/test-render";
import type { HouseChurchesClient } from "../house-churches/client";
import { FeedbackBars, FeedbackHistory } from "./history";

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
});
