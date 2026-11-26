/** @vitest-environment happy-dom */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormSchema } from "@/lib/forms/schema";
import { cleanup, render } from "@/components/missio/house-churches/test-render";
import { FormRuntime, initialValues } from "./form-runtime";
import { scalePoints } from "./numeric-fields";

// linear_scale and stepper on /f/<slug>. No network: fetch is a stub that
// records the body the runtime would send to /api/f/<slug>/submit.

const schema: FormSchema = {
  version: 1,
  branding: { logoUrl: null, accentColor: null },
  thankYou: { heading: "Thank you", message: "Sent." },
  steps: [
    {
      id: "s1",
      title: "How did it go?",
      fields: [
        { id: "f_email", type: "email", label: "Email", key: "email", required: true },
        {
          id: "f_leader",
          type: "linear_scale",
          label: "How are you doing as a leader?",
          key: "leader_score",
          required: true,
          min: 1,
          max: 5,
          minLabel: "Struggling",
          maxLabel: "Doing great",
        },
        {
          id: "f_saved",
          type: "stepper",
          label: "Saved",
          key: "saved",
          required: true,
          min: 0,
          max: 6,
          maxLabel: "More than 5",
        },
      ],
    },
  ],
};

function byText(host: HTMLElement, selector: string, text: string): HTMLElement {
  const el = [...host.querySelectorAll<HTMLElement>(selector)].find((e) => e.textContent?.trim() === text);
  if (!el) throw new Error(`No ${selector} with text "${text}"`);
  return el;
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function type(el: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("/f/<slug> runtime: linear_scale and stepper", () => {
  const roots: Array<ReturnType<typeof render>["root"]> = [];
  const hosts: HTMLElement[] = [];
  afterEach(() => {
    cleanup(roots, hosts);
    vi.unstubAllGlobals();
  });

  function mount() {
    const view = render(<FormRuntime slug="weekly" schema={schema} formName="Weekly" />);
    roots.push(view.root);
    hosts.push(view.host);
    return view.host;
  }

  it("draws a 1–5 scale with its end labels, and a counter starting at its lowest value", () => {
    const host = mount();
    const radios = host.querySelectorAll('[role="radio"]');
    expect([...radios].map((r) => r.textContent)).toEqual(["1", "2", "3", "4", "5"]);
    expect(host.textContent).toContain("Struggling");
    expect(host.textContent).toContain("Doing great");
    expect(host.querySelector("output")?.textContent).toBe("0");
    expect(initialValues(schema)).toEqual({ saved: 0 });
  });

  it("asks for the scale before sending, then sends both numbers as whole numbers", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const host = mount();

    type(host.querySelector<HTMLInputElement>('input[type="email"]')!, "lead@example.org");
    click(byText(host, "button", "Submit"));
    expect(host.textContent).toContain("How are you doing as a leader? is required");
    expect(fetchMock).not.toHaveBeenCalled();

    click(byText(host, '[role="radio"]', "2"));
    expect(byText(host, '[role="radio"]', "2").getAttribute("aria-checked")).toBe("true");

    const more = host.querySelector<HTMLButtonElement>('button[aria-label="More: Saved"]')!;
    for (let i = 0; i < 8; i++) click(more);
    // Stops at the top, which reads as "More than 5".
    expect(host.querySelector("output")?.textContent).toBe("6");
    expect(host.textContent).toContain("More than 5");
    expect(more.disabled).toBe(true);
    click(host.querySelector<HTMLButtonElement>('button[aria-label="Less: Saved"]')!);

    await act(async () => {
      byText(host, "button", "Submit").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/f/weekly/submit");
    expect(JSON.parse(String(init.body))).toEqual({
      data: { email: "lead@example.org", leader_score: 2, saved: 5 },
    });
  });

  it("caps a scale at 11 points", () => {
    expect(scalePoints({ type: "linear_scale", min: 0, max: 10 })).toHaveLength(11);
    expect(scalePoints({ type: "linear_scale", min: null, max: null })).toEqual([1, 2, 3, 4, 5]);
  });
});
