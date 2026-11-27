/** @vitest-environment happy-dom */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, setValue, settle } from "@/components/missio/house-churches/test-render";
import { pmApi } from "./client";
import { RequestCard } from "./request-card";
import type { PmRequest } from "./types";

// The request card's actions against a stubbed fetch. Names are made up.

const STAMP = "2026-11-26T08:14:00.000Z";
const SERVER_TEXT = "Already denied by Robin Leader (server words)";

function req(over: Partial<PmRequest> = {}): PmRequest {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    department_id: "d",
    requester_id: "u-sam",
    leave_type_id: "t-sick",
    start_date: "2026-11-26",
    end_date: "2026-12-01",
    start_part: "full",
    end_part: "full",
    days_count: 4,
    days_by_year: { "2026": 4 },
    notes: "Flu, doctor's note to follow.",
    covering_user_id: null,
    covering_note: null,
    status: "pending",
    decided_by: null,
    decided_at: null,
    decision_note: null,
    cancelled_by: null,
    cancelled_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    type: { id: "t-sick", slug: "sick", label: "Sick" },
    requester: { id: "u-sam", name: "Sam Example" },
    covering: null,
    decided_by_person: null,
    sent_to: [{ user_id: "u-robin", name: "Robin Leader", ok: true, error: null }],
    can_cancel: false,
    can_decide: false,
    ...over,
  };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function buttons(host: HTMLElement): string[] {
  return [...host.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "");
}

function byText(host: HTMLElement, text: string): HTMLButtonElement {
  const el = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  if (!el) throw new Error(`No button "${text}" in ${buttons(host).join(", ")}`);
  return el as HTMLButtonElement;
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("RequestCard actions", () => {
  const roots: Array<ReturnType<typeof render>["root"]> = [];
  const hosts: HTMLElement[] = [];
  afterEach(() => {
    cleanup(roots, hosts);
    vi.unstubAllGlobals();
  });

  function mount(r: PmRequest, onChanged = vi.fn(), view: "mine" | "leader" | "person" = "leader") {
    const view_ = render(<RequestCard request={r} api={pmApi("prayer_and_worship")} view={view} onChanged={onChanged} />);
    roots.push(view_.root);
    hosts.push(view_.host);
    return { host: view_.host, onChanged };
  }

  it("shows no actions unless can_decide / can_cancel say so", () => {
    const { host } = mount(req());
    expect(buttons(host)).toEqual([]);
  });

  it("shows Approve and Decline… only when can_decide", () => {
    const { host } = mount(req({ can_decide: true }));
    expect(buttons(host)).toEqual(["Approve", "Decline…"]);
    expect(host.textContent).not.toContain("Cancel request");
  });

  it("shows Cancel request only when can_cancel", () => {
    const { host } = mount(req({ can_cancel: true }), vi.fn(), "mine");
    expect(buttons(host)).toEqual(["Cancel request"]);
  });

  it("labels a declined request Declined and shows the leader's note", () => {
    const { host } = mount(
      req({
        status: "declined",
        decided_by: "u-robin",
        decided_at: STAMP,
        decision_note: "Outreach week.",
        decided_by_person: { id: "u-robin", name: "Robin Leader" },
      }),
      vi.fn(),
      "mine"
    );
    expect(host.textContent).toContain("Declined");
    expect(host.textContent).not.toMatch(/denied/i);
    expect(host.textContent).toContain("Robin:");
    expect(host.textContent).toContain("Outreach week.");
  });

  it("won't send a decline without a note, then sends declined (never denied)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { success: true, request: req({ status: "declined" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const { host, onChanged } = mount(req({ can_decide: true }));
    click(byText(host, "Decline…"));
    const send = byText(host, "Decline request");
    expect(send.disabled).toBe(true);
    click(send);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => setValue(host.querySelector("textarea")!, "Let's talk first."));
    expect(byText(host, "Decline request").disabled).toBe(false);
    click(byText(host, "Decline request"));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/departments/prayer_and_worship/people-manager/requests/11111111-1111-4111-8111-111111111111/decision");
    expect(JSON.parse(init.body)).toEqual({ decision: "declined", note: "Let's talk first." });
    expect(init.body).not.toContain("denied");
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ status: "declined" }));
  });

  it("approves with { decision: approved }", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { success: true, request: req({ status: "approved" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const { host } = mount(req({ can_decide: true }));
    click(byText(host, "Approve"));
    await settle();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ decision: "approved" });
  });

  it("on 409 already decided shows fixed copy, not the server's, and asks for a refetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json(409, { error: SERVER_TEXT, code: "leave_request_already_decided", request: req({ status: "declined" }) }))
    );
    const { host, onChanged } = mount(req({ can_decide: true }));
    click(byText(host, "Approve"));
    await settle();
    expect(host.textContent).toContain("Someone else decided this request first.");
    expect(host.textContent).not.toContain("server words");
    expect(host.textContent).not.toMatch(/denied/i);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith();
  });

  it("maps other failures by code only", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(403, { error: SERVER_TEXT, code: "leave_request_not_approver" })));
    const { host, onChanged } = mount(req({ can_decide: true }));
    click(byText(host, "Approve"));
    await settle();
    expect(host.textContent).toContain("Only another leader of this department, or an admin, can decide this request.");
    expect(host.textContent).not.toContain("server words");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("never renders a failed Slack delivery's server error, and offers a resend", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { success: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { host } = mount(
      req({ can_cancel: true, sent_to: [{ user_id: "u-robin", name: "Robin Leader", ok: false, error: "channel_not_found (server words)" }] }),
      vi.fn(),
      "mine"
    );
    expect(host.textContent).toContain("didn't reach Robin");
    expect(host.textContent).not.toContain("channel_not_found");
    click(byText(host, "Resend notification"));
    await settle();
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/notify$/);
    expect(host.textContent).toContain("Sent again.");
  });

  it("cancels after a second tap", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { success: true, request: req({ status: "cancelled" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const { host, onChanged } = mount(req({ can_cancel: true }), vi.fn(), "mine");
    click(byText(host, "Cancel request"));
    expect(fetchMock).not.toHaveBeenCalled();
    click(byText(host, "Yes, cancel it"));
    await settle();
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/cancel$/);
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }));
  });
});
