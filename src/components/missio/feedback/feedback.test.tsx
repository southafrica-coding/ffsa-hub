/** @vitest-environment happy-dom */
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "../house-churches/test-render";
import { FeedbackBars } from "./history";

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
});
