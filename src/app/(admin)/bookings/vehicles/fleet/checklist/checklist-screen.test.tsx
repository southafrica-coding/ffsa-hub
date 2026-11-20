/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, toast } = vi.hoisted(() => ({ refresh: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast }));

import { defaultChecklist } from "@/lib/fleet/content";
import { checklistOrder, itemsFor, type Checklist } from "@/lib/fleet/rules";
import { ChecklistScreen } from "./checklist-screen";
import { helpFor } from "./help";
import { SUGGEST_MONTHLY } from "./checklist-edit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STD = defaultChecklist();
const HELP = helpFor(checklistOrder(STD));

let host: HTMLDivElement, root: Root | null = null;
function render(props: { canManage?: boolean; saved?: boolean; checklist?: Checklist } = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(<ChecklistScreen checklist={props.checklist ?? STD} standard={STD} saved={props.saved ?? true} canManage={props.canManage ?? true} help={HELP} />)
  );
}
const buttons = (text: string) => [...host.querySelectorAll("button")].filter((b) => b.textContent?.trim() === text);
const button = (text: string) => buttons(text)[0];
const click = (el: Element | undefined) => act(() => (el as HTMLElement).click());

beforeEach(() => {
  refresh.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Checklist view", () => {
  it("shows the counts per check and every point", () => {
    render();
    expect(host.textContent).toContain("149 points in");
    expect(host.textContent).toContain("customised for FFSA");
    expect(host.querySelectorAll("li[data-item]").length).toBe(149);
    const nums = [...host.querySelectorAll(".numeral")].map((n) => Number(n.textContent));
    expect(nums).toEqual(["pre", "post", "weekly", "monthly", "workshop"].map((t) => itemsFor(STD, t).length));
  });

  it("says standard list when nothing is saved", () => {
    render({ saved: false });
    expect(host.textContent).toContain("standard list");
  });

  it("filters by check", () => {
    render();
    click(button("Pre-trip check"));
    expect(host.querySelectorAll("li[data-item]").length).toBe(itemsFor(STD, "pre").length);
    expect(button("Pre-trip check").getAttribute("aria-pressed")).toBe("true");
    click(button("All points"));
    expect(host.querySelectorAll("li[data-item]").length).toBe(149);
  });

  it("opens why and how for one point, or for every point", () => {
    render();
    click(buttons("Why and how")[0]);
    expect(host.textContent).toContain("Why it matters");
    expect(buttons("Hide why and how").length).toBe(1);
    const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    act(() => box.click());
    expect(buttons("Hide why and how").length).toBe(149);
    expect(host.textContent).toContain("How to mark it");
  });

  it("hides sort and edit from people who can't manage", () => {
    render({ canManage: false });
    expect(button("Sort weekly and monthly")).toBeUndefined();
    expect(button("Edit checklist")).toBeUndefined();
  });
});

describe("Sort weekly and monthly", () => {
  it("applies the suggestions and saves the whole checklist", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render();
    click(button("Sort weekly and monthly"));
    expect(host.textContent).toContain("Weekly or monthly");
    const monthlyEligible = itemsFor(STD, "monthly").length;
    expect(host.querySelectorAll("li[data-item]").length).toBe(monthlyEligible);

    click(button("Make all weekly"));
    expect(host.textContent).toContain(`${monthlyEligible} points every week · 0 more once a month`);

    click(button("Use all suggestions"));
    expect(toast.success).toHaveBeenCalledWith("Suggestions applied. Check them, then save.");
    const suggested = itemsFor(STD, "monthly").filter((id) => SUGGEST_MONTHLY.has(id)).length;
    expect(host.textContent).toContain(`${monthlyEligible - suggested} points every week · ${suggested} more once a month`);

    // One point back to weekly by hand.
    const first = host.querySelector(`li[data-item="${itemsFor(STD, "monthly").find((id) => SUGGEST_MONTHLY.has(id))}"]`)!;
    const every = [...first.querySelectorAll("button")].find((b) => b.textContent === "Every week")!;
    click(every);
    expect(every.getAttribute("aria-pressed")).toBe("true");

    await act(async () => button("Save")!.click());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/vehicles/fleet/settings");
    expect(init.method).toBe("PATCH");
    const sent = JSON.parse(String(init.body)).checklist as Checklist;
    expect(checklistOrder(sent).length).toBe(149);
    expect(itemsFor(sent, "weekly").length).toBe(monthlyEligible - suggested + 1);
    expect(toast.success).toHaveBeenCalledWith("Checklist saved.");
    expect(refresh).toHaveBeenCalled();
    expect(host.textContent).toContain("Inspection checklist");
  });

  it("Cancel leaves the checklist as it was", () => {
    render();
    click(button("Sort weekly and monthly"));
    click(button("Make all weekly"));
    click(button("Cancel"));
    expect(host.querySelectorAll(".numeral")[2].textContent).toBe(String(itemsFor(STD, "weekly").length));
  });
});

describe("Edit checklist", () => {
  const small: Checklist = { sections: [{ id: "a", name: "Outside", items: [{ id: "p1", t: "Front", h: "", in: ["weekly"] }] }] };

  it("changes wording, ticks checks, adds a point and saves", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render({ checklist: small });
    click(button("Edit checklist"));
    expect(host.textContent).toContain("Tick which checks each point belongs to.");

    const setValue = (el: HTMLInputElement, v: string) =>
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
    setValue(host.querySelector<HTMLInputElement>('input[aria-label="Point"]')!, "Front bumper");
    const pre = [...host.querySelectorAll("label")].find((l) => l.textContent?.trim() === "Pre-trip")!.querySelector("input")!;
    act(() => pre.click());
    click(button("Add point"));
    expect(host.querySelectorAll('input[aria-label="Point"]').length).toBe(2);

    await act(async () => button("Save checklist")!.click());
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).checklist as Checklist;
    // The blank new point is left out, as the app does.
    expect(sent).toEqual({ sections: [{ id: "a", name: "Outside", items: [{ id: "p1", t: "Front bumper", h: "", in: ["pre", "weekly"] }] }] });
  });

  it("refuses to save an empty checklist", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", () => true);
    render({ checklist: small });
    click(button("Edit checklist"));
    click(button("Remove section"));
    await act(async () => button("Save checklist")!.click());
    expect(toast.error).toHaveBeenCalledWith("The checklist needs at least one point.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("restores the standard list", () => {
    vi.stubGlobal("confirm", () => true);
    render({ checklist: small });
    click(button("Edit checklist"));
    click(button("Restore standard list"));
    expect(host.querySelectorAll('input[aria-label="Point"]').length).toBe(149);
  });
});
