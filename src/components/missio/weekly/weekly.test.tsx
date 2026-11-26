/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, setValue, settle } from "../house-churches/test-render";
import { buildSundayResults } from "@/lib/missio/sunday-results";
import { FIXTURE_FILL, FIXTURE_HOUSES, FIXTURE_ROWS, FIXTURE_SUNDAY } from "@/lib/missio/weekly-fixtures";
import { planStep, WeeklyFeedbackFill, type SubmitOutcome } from "./fill";
import { SundayResultsView } from "./results";

describe("weekly feedback fill and Sunday results", () => {
  const roots: Array<ReturnType<typeof render>["root"]> = [];
  const hosts: HTMLElement[] = [];
  afterEach(() => {
    cleanup(roots, hosts);
    vi.restoreAllMocks();
  });
  function mount(node: ReactNode) {
    const view = render(node);
    roots.push(view.root);
    hosts.push(view.host);
    return view.host;
  }
  const click = (el: Element | null) => act(() => (el as HTMLElement).click());
  const byText = (host: HTMLElement, sel: string, text: string) =>
    [...host.querySelectorAll(sel)].find((el) => el.textContent?.trim() === text) ?? null;

  it("lays the numbers out like the mockup: headline count, then pairs", () => {
    const blocks = planStep(FIXTURE_FILL.schema.steps[0].fields.filter((f) => !f.parentFieldId));
    expect(blocks.map((b) => b.kind)).toEqual(["count", "pair", "field", "pair"]);
    expect(planStep(FIXTURE_FILL.schema.steps[1].fields).map((b) => b.kind)).toEqual(["fruit"]);
  });

  it("shows the house and Sunday from the link, with no house or Sunday question", () => {
    const host = mount(<WeeklyFeedbackFill {...FIXTURE_FILL} initial={{}} endpoint="/x" />);
    expect(host.textContent).toContain("House 18 · Sunday 22 Nov 2026");
    expect(host.textContent).toContain("House 18");
    expect(host.textContent).toContain("Please do not write names of guests or personal details.");
    expect(host.querySelectorAll("select")).toHaveLength(2); // win type, challenge type only
    expect(host.textContent).not.toMatch(/Which Sunday|House church number/);
    // Starts from last week's count.
    expect((host.querySelector("input[aria-labelledby='wf-wf_attendance']") as HTMLInputElement).value).toBe("12");
  });

  it("keeps first-timers a count until the box is ticked, then asks for a name", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const submit = async (answers: Record<string, unknown>): Promise<SubmitOutcome> => {
      sent.push(answers);
      return { ok: true };
    };
    const host = mount(<WeeklyFeedbackFill {...FIXTURE_FILL} endpoint="/x" submit={submit} />);
    expect(host.textContent).not.toContain("Their first name");

    const box = host.querySelector("[role=checkbox]") as HTMLElement;
    expect(box.getAttribute("aria-checked")).toBe("false");
    click(box);
    expect(host.textContent).toContain("Their first name");

    // Ticked with no name: nothing is sent.
    await act(async () => (host.querySelector("form") as HTMLFormElement).requestSubmit());
    expect(sent).toHaveLength(0);
    expect(host.textContent).toContain("Please answer this one.");

    setValue(host.querySelector("#wf-wf_first_name-in") as HTMLInputElement, "Thabo");
    setValue(host.querySelector("#wf-wf_phone-in") as HTMLInputElement, "0821234567");
    await settle();
    // Untick: the name must not travel.
    click(host.querySelector("[role=checkbox]"));
    await act(async () => (host.querySelector("form") as HTMLFormElement).requestSubmit());
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toHaveProperty("first_name");
    expect(sent[0]).toMatchObject({ share_name: false, attendance: 11, first_time_count: 1 });
    expect(host.textContent).toContain("We are praying for you and your house church this week.");

    // Change what I sent, tick again: now the name goes.
    click(byText(host, "button", "Change what I sent"));
    click(host.querySelector("[role=checkbox]"));
    await act(async () => (host.querySelector("form") as HTMLFormElement).requestSubmit());
    await settle();
    expect(sent[1]).toMatchObject({ share_name: true, first_name: "Thabo", phone: "0821234567" });
  });

  it("lets 'No help needed' and a training need not both be picked", () => {
    const host = mount(<WeeklyFeedbackFill {...FIXTURE_FILL} endpoint="/x" />);
    const chip = (t: string) => byText(host, "button", t) as HTMLElement;
    expect(chip("Discipleship").getAttribute("aria-pressed")).toBe("true");
    click(chip("No help needed right now"));
    expect(chip("Discipleship").getAttribute("aria-pressed")).toBe("false");
    click(chip("Hospitality"));
    expect(chip("No help needed right now").getAttribute("aria-pressed")).toBe("false");
  });

  it("shows the server's field errors", async () => {
    const host = mount(
      <WeeklyFeedbackFill {...FIXTURE_FILL} endpoint="/x" submit={async () => ({ ok: false, error: "Weekly feedback isn’t open yet.", fieldErrors: {} })} />
    );
    await act(async () => (host.querySelector("form") as HTMLFormElement).requestSubmit());
    await settle();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("isn’t open yet");
  });

  describe("results", () => {
    const results = buildSundayResults(FIXTURE_HOUSES, FIXTURE_ROWS, FIXTURE_SUNDAY);

    it("shows missing houses, totals, flags and every house", () => {
      const host = mount(<SundayResultsView results={results} nudge={{ enabled: false, endpoint: "/n" }} />);
      expect(host.textContent).toContain("14 of 20 houses have sent feedback.");
      expect(host.textContent).toContain("Houses 3, 7, 9, 12, 16 and 19.");
      expect(host.textContent).toContain("House 17 · leader wellbeing");
      expect(host.querySelectorAll("li[data-state]")).toHaveLength(20);
    });

    it("sends no nudge and makes no request while the nudge is off", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const sendNudge = vi.fn(async () => ({ status: "done", sent: 3 }));
      const host = mount(<SundayResultsView results={results} nudge={{ enabled: false, endpoint: "/n" }} sendNudge={sendNudge} />);
      const button = byText(host, "button", "Send nudge") as HTMLButtonElement;
      expect(button.dataset.nudge).toBe("off");
      click(button);
      await settle();
      expect(sendNudge).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(host.querySelector("[role=status]")?.textContent).toContain("switched off");
    });

    it("asks the server when the nudge is on", async () => {
      const sendNudge = vi.fn(async () => ({ status: "done", sent: 6 }));
      const host = mount(<SundayResultsView results={results} nudge={{ enabled: true, endpoint: "/n" }} sendNudge={sendNudge} />);
      click(byText(host, "button", "Send nudge"));
      await settle();
      expect(sendNudge).toHaveBeenCalledTimes(1);
      expect(host.querySelector("[role=status]")?.textContent).toBe("Sent to 6 leaders.");
    });
  });
});
