// @vitest-environment happy-dom
// The inspection screen in a browser-like DOM: opens a new draft and keeps it on the
// device under the key the vehicle page reads, one tap per point moves on, Full list
// shows every section, and Save posts the draft.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedFleetData } from "@/lib/fleet/testing/seed";
import { draftKey } from "@/lib/fleet/inspection";
import { InspectForm, type InspectFormProps } from "./inspect-form";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const TODAY = "2026-11-17";
const F = seedFleetData(TODAY);
const v = { ...F.vehicles.find((x) => x.id === "h1-2")!, id: "00000000-0000-0000-0000-000000000002" };
const fetches: { url: string; method: string; body?: string }[] = [];

let root: Root;
let host: HTMLDivElement;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function props(over: Partial<InspectFormProps> = {}): InspectFormProps {
  return {
    vehicle: v,
    checklist: F.checklist,
    today: TODAY,
    defaultType: "weekly",
    inspectorName: "Jack Smith",
    startFresh: false,
    attention: [],
    attnByItem: {},
    ready: [],
    modelNotes: {},
    providers: ["Motech"],
    trips: [],
    defaultBookingId: "",
    ...over,
  };
}

async function open(p = props()) {
  await act(async () => {
    root.render(createElement(InspectForm, p));
  });
  await act(async () => {
    await sleep(20);
  });
}
const buttons = (label: string) => Array.from(host.querySelectorAll("button")).filter((b) => b.textContent?.trim() === label);
async function click(el: Element | undefined) {
  if (!el) throw new Error("no element");
  await act(async () => {
    (el as HTMLElement).click();
  });
}

// Node's own (empty) localStorage global can shadow the DOM's: use a plain one.
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, val) => void m.set(k, String(val)),
    removeItem: (k) => void m.delete(k),
    key: (i) => Array.from(m.keys())[i] ?? null,
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  fetches.length = 0;
  push.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      fetches.push({ url, method: init?.method || "GET", body: init?.body as string | undefined });
      if (url.startsWith("/api/vehicles/fleet/inspections")) return new Response(JSON.stringify({ success: true, id: "ins-1" }), { status: 200 });
      return new Response(JSON.stringify({ draft: null, updatedAt: null }), { status: 200 });
    })
  );
  vi.stubGlobal("confirm", () => true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("inspection screen", () => {
  it("starts a new draft, step by step, and keeps it on the device", async () => {
    await open();
    expect(host.textContent).toContain("New weekly check");
    expect(host.textContent).toContain("Get ready");
    expect((host.querySelector("#f-insp") as HTMLInputElement).value).toBe("Jack Smith");
    const stored = JSON.parse(localStorage.getItem(draftKey(v.id))!);
    expect(stored).toMatchObject({ vehicleId: v.id, type: "weekly", date: TODAY });
  });

  it("one tap on OK moves on to the next point", async () => {
    await open();
    await click(buttons("Next")[0]); // past Get ready to the first point
    const label = () => host.querySelector('[role="group"][aria-label^="Result:"]')?.getAttribute("aria-label");
    const first = label();
    expect(first).toMatch(/^Result: /);
    await click(buttons("OK")[0]);
    await act(async () => {
      await sleep(350);
    });
    expect(label()).not.toBe(first);
    const stored = JSON.parse(localStorage.getItem(draftKey(v.id))!);
    expect(Object.values(stored.results).some((r) => (r as { s: string }).s === "ok")).toBe(true);
    expect(stored.gstep).toBe(2);
  });

  it("Fix now opens the note instead of moving on", async () => {
    await open();
    await click(buttons("Next")[0]);
    await click(buttons("Fix now")[0]);
    await act(async () => {
      await sleep(350);
    });
    expect(host.querySelector("textarea[data-note]")).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(draftKey(v.id))!).gstep).toBe(1);
  });

  it("Full list shows every section of the check", async () => {
    await open();
    await click(buttons("Full list")[0]);
    const names = Array.from(host.querySelectorAll("details summary h2")).map((h) => h.textContent);
    expect(names.length).toBeGreaterThan(3);
    expect(host.textContent).toContain("Walk-around photos");
  });

  it("continues a draft from the device", async () => {
    localStorage.setItem(draftKey(v.id), JSON.stringify({ vehicleId: v.id, type: "monthly", date: TODAY, odometer: "1234", gstep: 0, results: {}, savedAt: 5 }));
    await open();
    expect(host.textContent).toContain("New monthly check");
    expect((host.querySelector("#f-odo") as HTMLInputElement).value).toBe("1234");
  });

  it("Save posts the draft and opens the saved inspection", async () => {
    await open();
    await act(async () => {
      const odo = host.querySelector("#f-odo") as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(odo, "225 100");
      odo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(buttons("Next")[0]);
    await click(buttons("OK")[0]);
    await click(buttons("Save weekly check")[0]);
    await act(async () => {
      await sleep(20);
    });
    const post = fetches.find((f) => f.url === "/api/vehicles/fleet/inspections");
    expect(post).toBeTruthy();
    const body = JSON.parse(post!.body!);
    expect(body.vehicleId).toBe(v.id);
    expect(body.draft.odometer).toBe("225 100");
    expect(push).toHaveBeenCalledWith("/bookings/vehicles/fleet/inspections/ins-1");
    expect(localStorage.getItem(draftKey(v.id))).toBeNull();
  });
});

describe("Workshop report: the workshop's 25-point check (Gideon, 20 Nov 2026)", () => {
  it("lists the 25 points first, in the sheet's order, then the rest, with a note next to each", async () => {
    const { defaultChecklist } = await import("@/lib/fleet/content");
    await open(props({ checklist: defaultChecklist(), defaultType: "workshop" }));
    const groups = Array.from(host.querySelectorAll("details summary h2")).map((h) => h.textContent);
    expect(groups).toEqual(["Workshop 25-point check", "If the workshop checked them"]);
    const first = host.querySelector("details")!;
    const points = Array.from(first.querySelectorAll("p.font-semibold")).map((p) => p.textContent);
    expect(points).toHaveLength(25);
    expect(points.slice(0, 3)).toEqual(["Engine oil", "Transmission oil", "Power steering oil"]);
    expect(points[24]).toBe("Headlights");
    // The note is always there, like the sheet's NOTES column.
    expect(first.querySelectorAll('input[aria-label^="Note: "]').length).toBe(25);
    // "Mark the rest OK" for the 25 lines, but not for the points the workshop may not have checked.
    const [sheet, more] = Array.from(host.querySelectorAll("details"));
    expect(Array.from(sheet.querySelectorAll("button")).some((b) => b.textContent === "Mark the rest OK")).toBe(true);
    expect(Array.from(more.querySelectorAll("button")).some((b) => b.textContent === "Mark the rest OK")).toBe(false);
  });
});
