/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, setValue, settle } from "../house-churches/test-render";
import { FeedbackBars } from "./history";
import { FeedbackForm } from "./public-form";

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

  it("starts at last week's count, takes new names and a mood, and sends", async () => {
    const sent: unknown[] = [];
    const host = mount(
      <FeedbackForm
        token="t"
        view={{ houseTitle: "House 5", meetingDate: "2026-11-18", lastAttendance: 21, existing: null }}
        submit={async (_token, body) => {
          sent.push(body);
          return { meetingDate: "2026-11-18", attendance: 22, mood: "great", newNames: ["Thabo Nkosi"], prayer: null, notes: null, submittedAt: "x" };
        }}
      />
    );
    expect(host.textContent).toContain("House 5 ·");
    expect(host.textContent).toContain("Wednesday");
    const count = host.querySelector("[aria-label='How many came']") as HTMLInputElement;
    expect(count.value).toBe("21");
    act(() => (host.querySelector("[aria-label='One more']") as HTMLButtonElement).click());
    expect(count.value).toBe("22");

    const form = host.querySelector("form") as HTMLFormElement;
    await act(async () => form.requestSubmit());
    expect(host.textContent).toContain("Choose how it went.");
    expect(sent).toHaveLength(0);

    setValue(host.querySelector("[aria-label=\"New person's name\"]") as HTMLInputElement, "Thabo Nkosi");
    await settle();
    act(() => (host.querySelector("input[value=great]") as HTMLInputElement).click());
    await act(async () => {
      form.requestSubmit();
      await Promise.resolve();
    });
    await settle();
    expect(sent[0]).toMatchObject({ attendance: 22, mood: "great", newNames: ["Thabo Nkosi"] });
    expect(host.querySelector("[data-testid=feedback-sent-count]")?.textContent).toContain("22");
    expect(host.textContent).toContain("Change what I sent");
  });

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
