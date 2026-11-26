/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, toast } = vi.hoisted(() => ({ refresh: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast }));

import { BookingActions } from "./booking-actions";
import { BookingStatusProvider } from "./status-context";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Fake people and bookings only.
const jordan = {
  date: "2026-12-01",
  existingId: "e1",
  existingTitle: "Example Study Group",
  existingTime: "11:30 – 13:00",
  existingWindow: "11:30 – 13:00",
  occupiedUntil: "13:00",
  who: "Jordan Example",
};
const alex = {
  date: "2026-12-08",
  existingId: "e2",
  existingTitle: "Example Prayer Hour",
  existingTime: "12:30 – 13:30",
  existingWindow: "12:30 – 13:30",
  occupiedUntil: "13:30",
  who: "Alex Placeholder",
};

let host: HTMLDivElement, root: Root | null = null;
function render(hasSeries = false) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <BookingStatusProvider initialStatus="pending">
        <BookingActions bookingId="b1" hasSeries={hasSeries} canApprove canCancel={false} venueName="Office 2" />
      </BookingStatusProvider>
    )
  );
}
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
const panel = () => host.querySelector('[role="alert"]');

let fetchMock: ReturnType<typeof vi.fn>;
const respond = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
const sent = (i: number) => JSON.parse((fetchMock.mock.calls[i][1] as RequestInit).body as string);

async function click(el: HTMLElement | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el!.click();
  });
}
function type(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  refresh.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("BookingActions: approving over a clash", () => {
  it("an approver who can't override sees the clash inline, Approve becomes Time taken, Deny stays", async () => {
    render();
    respond(409, { error: "lead", conflicts: [jordan], blocked: true, canOverride: false });
    await click(button("Approve"));

    expect(toast.error).not.toHaveBeenCalled();
    const p = panel()!;
    expect(p.textContent).toContain("This time is taken");
    expect(p.textContent).toContain("Office 2 is already booked by Jordan Example");
    expect(p.textContent).toContain("Example Study Group");
    expect(p.textContent).toContain("11:30 – 13:00");
    expect(p.textContent).toContain("can't be approved as it stands");
    expect(p.textContent).toContain("Deny it, or ask the requester to move it");
    expect(p.textContent).not.toContain("pick another time");
    expect(p.textContent).not.toContain("Talk to them");
    expect(button("Book anyway")).toBeUndefined();

    expect(button("Approve")).toBeUndefined();
    expect(button("Time taken")!.disabled).toBe(true);
    expect(button("Deny")!.disabled).toBe(false);

    // Denying clears the clash and goes ahead.
    respond(200, { ok: true });
    await click(button("Deny"));
    expect(sent(1)).toMatchObject({ decision: "denied" });
    expect(sent(1).override).toBeUndefined();
    expect(toast.success).toHaveBeenCalledWith("Booking denied.");
  });

  it("a manager sees every clashing date, and books anyway only with a reason", async () => {
    render(true);
    act(() => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    respond(409, { error: "lead", conflicts: [jordan, alex], blocked: true, canOverride: true });
    await click(button("Approve"));
    expect(sent(0)).toMatchObject({ decision: "approved", applyToSeries: true });

    expect(toast.error).not.toHaveBeenCalled();
    const p = panel()!;
    expect(p.textContent).toContain("These times are taken");
    for (const t of ["Jordan Example", "Example Study Group", "Alex Placeholder", "Example Prayer Hour", "12:30 – 13:30"]) {
      expect(p.textContent).toContain(t);
    }
    expect(p.textContent).toContain("can't be approved as they stand");
    expect(p.textContent).not.toContain("pick other times");
    expect(p.textContent).not.toContain("Deny it, or ask the requester");
    expect(button("Time taken")!.disabled).toBe(true);

    await click(button("Book anyway")); // the panel's: opens the reason
    const reason = host.querySelector("textarea[required]") as HTMLTextAreaElement;
    expect(reason.maxLength).toBe(500);
    // The panel's button is gone; the only "Book anyway" now is Approve's.
    expect([...host.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "Book anyway")).toHaveLength(1);
    expect(button("Book anyway")!.disabled).toBe(true);

    type(reason, "   ");
    expect(button("Book anyway")!.disabled).toBe(true);
    type(reason, "x".repeat(600));
    expect(reason.value).toHaveLength(500);
    expect(host.textContent).toContain("500 / 500");

    type(reason, "Agreed with both; they move to Office 1.");
    expect(button("Book anyway")!.disabled).toBe(false);
    respond(200, { ok: true, appliedToSeries: true });
    await click(button("Book anyway"));
    expect(sent(1)).toEqual({
      decision: "approved",
      note: null,
      applyToSeries: true,
      override: { reason: "Agreed with both; they move to Office 1." },
    });
    expect(toast.success).toHaveBeenCalledWith("Booking approved.");
  });

  it("toggling apply-to-series clears the clash", async () => {
    render(true);
    respond(409, { error: "lead", conflicts: [jordan], blocked: true, canOverride: true });
    await click(button("Approve"));
    expect(panel()).toBeTruthy();

    act(() => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    expect(panel()).toBeNull();
    expect(button("Approve")!.disabled).toBe(false);
  });

  it("a clash nobody could be named for still says so inline, without booker wording", async () => {
    render();
    const apiMsg = "Office 2 has just been booked at that time. Refresh to see the latest, then pick another time.";
    respond(409, { error: apiMsg, conflicts: [], blocked: true, canOverride: false });
    await click(button("Approve"));
    expect(toast.error).not.toHaveBeenCalled();
    const text = panel()!.textContent!;
    expect(text).toBe(
      "This time has just been booked by someone else, so it can't be approved as it stands. Deny it, or ask the requester to move it."
    );
    expect(text).not.toContain("pick another time");
    expect(text).not.toContain(apiMsg);
    expect(button("Approve")!.disabled).toBe(false); // trying again re-checks
  });

  it("a manager's unnamed clash stays simple, with no booker wording or Book anyway", async () => {
    render();
    respond(409, {
      error: "Office 2 has just been booked at that time. Refresh to see the latest, then pick another time.",
      blocked: true,
      canOverride: true,
    });
    await click(button("Approve"));
    const text = panel()!.textContent!;
    expect(text).toBe(
      "This time has just been booked by someone else, so it can't be approved as it stands."
    );
    expect(text).not.toContain("pick another time");
    expect(text).not.toContain("Deny it, or ask the requester");
    expect(button("Book anyway")).toBeUndefined();
    expect(button("Approve")!.disabled).toBe(false);
  });
});
