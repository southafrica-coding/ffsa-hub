/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, settle } from "../house-churches/test-render";
import { FIXTURE_FILL } from "@/lib/missio/weekly-fixtures";
import { WeeklyFeedbackFill, type SubmitMeta, type SubmitOutcome } from "./fill";

// The one public link's fill: "Which house church are you in?" first,
// required, and sent beside the answers. The house link and the
// signed-in page never show it and never send a house.

const H4 = "44444444-4444-4444-8444-444444444444";
const H7 = "77777777-7777-4777-8777-777777777777";
const HOUSES = [
  { id: H4, number: 4, name: "Sipho & Naledi" },
  { id: H7, number: 7, name: null },
];

describe("public weekly feedback (house picker)", () => {
  const roots: Array<ReturnType<typeof render>["root"]> = [];
  const hosts: HTMLElement[] = [];
  afterEach(() => {
    cleanup(roots, hosts);
    vi.unstubAllGlobals();
  });
  function mount(node: ReactNode) {
    const view = render(node);
    roots.push(view.root);
    hosts.push(view.host);
    return view.host;
  }
  const pick = (host: HTMLElement, id: string) =>
    act(() => {
      const select = host.querySelector("[data-testid=public-house-picker]") as HTMLSelectElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(select, id);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  const sendForm = (host: HTMLElement) => act(async () => (host.querySelector("form") as HTMLFormElement).requestSubmit());

  it("asks which house church first, labelled number + name, and only those", () => {
    const host = mount(<WeeklyFeedbackFill {...FIXTURE_FILL} initial={{}} lastAttendance={null} sentBefore={false} endpoint="/x" picker={{ houses: HOUSES }} />);
    const select = host.querySelector("select") as HTMLSelectElement;
    // The first control in the form is the picker.
    expect(select.getAttribute("data-testid")).toBe("public-house-picker");
    expect(select.required).toBe(true);
    expect(select.getAttribute("aria-labelledby")).toBe("wf-house");
    expect(host.querySelector("#wf-house")?.textContent).toContain("Which house church are you in?");
    expect([...select.options].map((o) => o.textContent)).toEqual(["Choose your house church", "House 4 · Sipho & Naledi", "House 7"]);
    expect([...select.options].map((o) => o.value)).toEqual(["", H4, H7]);
    // No house is assumed: no "House 18" from the fixture, no leaders' names.
    expect(host.textContent).not.toContain("House 18");
    expect(host.textContent).not.toContain(FIXTURE_FILL.leaders ?? "@@");
    expect(host.textContent).toContain("Choose your house church, then fill this in");
    // The honeypot is there, empty, and out of the tab order.
    const trap = host.querySelector("[data-testid=public-honeypot]") as HTMLInputElement;
    expect(trap.value).toBe("");
    expect(trap.tabIndex).toBe(-1);
    expect(trap.getAttribute("aria-hidden")).toBe("true");
  });

  it("won't send without a house; with one, sends its id beside the answers", async () => {
    const sent: Array<[Record<string, unknown>, SubmitMeta | undefined]> = [];
    const submit = async (answers: Record<string, unknown>, meta?: SubmitMeta): Promise<SubmitOutcome> => {
      sent.push([answers, meta]);
      return { ok: true };
    };
    const host = mount(<WeeklyFeedbackFill {...FIXTURE_FILL} endpoint="/x" submit={submit} picker={{ houses: HOUSES }} />);
    await sendForm(host);
    expect(sent).toHaveLength(0);
    expect(host.textContent).toContain("Choose your house church.");

    await pick(host, H7);
    expect(host.textContent).not.toContain("Choose your house church.");
    expect(host.textContent).toContain("House 7 ·");
    await sendForm(host);
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0][1]).toEqual({ houseId: H7, website: "" });
    // The house is never one of the answers.
    expect(sent[0][0]).not.toHaveProperty("house_church");
    expect(sent[0][0]).not.toHaveProperty("houseId");
  });

  it("posts { houseId, answers, website } to the public endpoint", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      })
    );
    const host = mount(<WeeklyFeedbackFill {...FIXTURE_FILL} endpoint="/api/f/missio-weekly-feedback/submit" picker={{ houses: HOUSES }} />);
    await pick(host, H4);
    await sendForm(host);
    await settle();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ houseId: H4, website: "" });
    expect(bodies[0]).toHaveProperty("answers");
  });

  it("the house link and the signed-in page show no picker and send answers only", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      })
    );
    const host = mount(<WeeklyFeedbackFill {...FIXTURE_FILL} endpoint="/api/serve/missio/feedback/tok" />);
    expect(host.querySelector("[data-testid=public-house-picker]")).toBeNull();
    expect(host.querySelector("[data-testid=public-honeypot]")).toBeNull();
    expect(host.textContent).not.toContain("Which house church are you in?");
    await sendForm(host);
    await settle();
    expect(bodies).toHaveLength(1);
    expect(Object.keys(bodies[0] as object)).toEqual(["answers"]);
  });
});
