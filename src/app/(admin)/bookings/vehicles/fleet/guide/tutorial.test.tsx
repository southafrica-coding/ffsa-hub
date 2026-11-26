/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, toast } = vi.hoisted(() => ({ refresh: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...p}>
      {children}
    </a>
  ),
}));

import { Tutorial, type TutorialStep } from "./tutorial";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const steps: TutorialStep[] = [
  { key: "open-today", title: "Open Today", text: "Start here.", href: "/bookings/vehicles/fleet/vehicles", action: null },
  { key: "log-a-km-reading", title: "Log a km reading", text: "Read the odometer.", href: null, action: { id: "km-log", label: "Log a km reading" } },
];

let host: HTMLDivElement, root: Root | null = null;
function render(done: string[] = []) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Tutorial steps={steps} done={done} kmVehicles={[{ id: "crv", name: "CR-V", reg: "CA 1" }]} today="2026-11-17" />));
}
const boxes = () => [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];

beforeEach(() => toast.error.mockReset());
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Tutorial", () => {
  it("numbers the steps, shows Open it and the action, and the person's ticks", () => {
    render(["log-a-km-reading"]);
    expect(host.textContent).toContain("1. Open Today");
    expect(host.textContent).toContain("2. Log a km reading");
    const open = [...host.querySelectorAll("a")].filter((a) => a.textContent === "Open it");
    expect(open.map((a) => a.getAttribute("href"))).toEqual(["/bookings/vehicles/fleet/vehicles"]);
    expect(boxes().map((b) => b.checked)).toEqual([false, true]);
    expect(boxes()[0].getAttribute("aria-label")).toBe("Done: Open Today");
  });

  it("saves a tick for this person", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render();
    await act(async () => boxes()[0].click());
    expect(boxes()[0].checked).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/vehicles/fleet/guide");
    expect(JSON.parse(String(init.body))).toEqual({ step: "open-today", done: true });
  });

  it("puts the tick back if saving fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Not authorized" }), { status: 403 })));
    render(["open-today"]);
    await act(async () => boxes()[0].click());
    expect(boxes()[0].checked).toBe(true);
    expect(toast.error).toHaveBeenCalledWith("Not authorized");
  });

  it("opens Log a km reading", () => {
    render();
    const b = [...host.querySelectorAll("button")].find((x) => x.textContent === "Log a km reading")!;
    act(() => b.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Log a km reading");
  });
});
