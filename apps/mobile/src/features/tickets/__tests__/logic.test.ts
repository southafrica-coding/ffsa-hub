import { ApiError } from "@/lib/api";

import { dateBlock, formatDay, formatEventWhen, formatTime, isPastEvent, splitByWhen } from "../dates";
import { canRunCheckIn } from "../permissions";
import { isTicketCode, parseTicketCode } from "../qr";
import { isRetryableError, verdictFromError, verdictFromOutcome, verdictNotATicket, verdictQueued } from "../result";
import { createScanGate } from "../scan-gate";
import { makeMe, NOW } from "../testing/fixtures";

describe("parseTicketCode", () => {
  it("accepts a bare base64url code, trimmed", () => {
    expect(parseTicketCode("  AbC-d_EfGh1 \n")).toEqual({ ok: true, code: "AbC-d_EfGh1" });
  });

  it("enforces the 4–64 length the server accepts", () => {
    expect(isTicketCode("abc")).toBe(false);
    expect(isTicketCode("abcd")).toBe(true);
    expect(isTicketCode("a".repeat(64))).toBe(true);
    expect(isTicketCode("a".repeat(65))).toBe(false);
  });

  it("rejects empty and non-ticket content", () => {
    expect(parseTicketCode("")).toEqual({ ok: false, reason: "empty" });
    expect(parseTicketCode(null)).toEqual({ ok: false, reason: "empty" });
    expect(parseTicketCode("WIFI:S:guest;T:WPA;P:secret;;")).toEqual({ ok: false, reason: "not_a_ticket" });
    expect(parseTicketCode("hello world")).toEqual({ ok: false, reason: "not_a_ticket" });
  });

  it("pulls the code out of a ticket URL, and nothing else", () => {
    expect(parseTicketCode("https://www.ffsahub.com/api/tickets/AbCdEfGhIjK/qr")).toEqual({ ok: true, code: "AbCdEfGhIjK" });
    expect(parseTicketCode("https://example.org/door?code=AbCdEfGhIjK")).toEqual({ ok: true, code: "AbCdEfGhIjK" });
    expect(parseTicketCode("https://example.org/some/poster")).toEqual({ ok: false, reason: "not_a_ticket" });
    expect(parseTicketCode("https://example.org/tickets/bad%20code")).toEqual({ ok: false, reason: "not_a_ticket" });
  });
});

describe("createScanGate (debounce)", () => {
  it("ignores the same code inside the window and accepts it after", () => {
    const g = createScanGate(3000);
    expect(g.accept("A", 0)).toBe(true);
    g.release();
    expect(g.accept("A", 2999)).toBe(false);
    expect(g.accept("A", 3000)).toBe(true);
  });

  it("accepts a different code straight away, but never while busy", () => {
    const g = createScanGate(3000);
    expect(g.accept("A", 0)).toBe(true);
    expect(g.busy).toBe(true);
    expect(g.accept("B", 10)).toBe(false);
    g.release();
    expect(g.accept("B", 20)).toBe(true);
  });

  it("reset() forgets the last code (after an undo)", () => {
    const g = createScanGate(3000);
    g.accept("A", 0);
    g.release();
    g.reset();
    expect(g.accept("A", 10)).toBe(true);
  });
});

describe("verdicts", () => {
  it("ok: ink, admit, undoable, names the guest", () => {
    const v = verdictFromOutcome({ result: "ok", ticketId: "t1", ticketTypeName: "General", buyerName: "Sample P" });
    expect(v).toMatchObject({
      kind: "checked_in",
      title: "Checked in",
      detail: "Sample P · General",
      style: "ink",
      icon: "check",
      haptic: "success",
      undoTicketId: "t1",
      admit: true,
    });
  });

  it("already in: yellow, with the time, not undoable, not admitted", () => {
    const v = verdictFromOutcome({ result: "already_checked_in", ticketTypeName: "VIP", checkedInAt: "2026-11-03T07:05:00.000Z" });
    expect(v.kind).toBe("already");
    expect(v.title).toMatch(/^Already checked in at \d\d:\d\d$/);
    expect(v).toMatchObject({ style: "accent", icon: "repeat", haptic: "warning", undoTicketId: null, admit: false });
    expect(verdictFromOutcome({ result: "already_checked_in", ticketTypeName: "VIP", checkedInAt: null }).title).toBe(
      "Already checked in",
    );
  });

  it.each([
    ["wrong_event", "Not a ticket for this event"],
    ["void", "Ticket cancelled"],
    ["invalid", "Not a ticket"],
  ] as const)("%s: a clear reject", (result, title) => {
    const v = verdictFromOutcome({ result });
    expect(v).toMatchObject({ title, style: "outline", icon: "stop", haptic: "error", admit: false, undoTicketId: null });
  });

  it("queued is never a success", () => {
    const v = verdictQueued();
    expect(v).toMatchObject({ kind: "queued", style: "dashed", icon: "clock", admit: false, undoTicketId: null });
    expect(v.title).toBe("Saved, not yet confirmed");
    expect(v.detail).toMatch(/NOT confirmed/);
  });

  it("not a ticket / needs attention", () => {
    expect(verdictNotATicket()).toMatchObject({ kind: "not_a_ticket", admit: false });
    expect(verdictFromError(new ApiError("http", "Server said no (500).", 500))).toMatchObject({
      kind: "needs_attention",
      title: "Needs attention",
      detail: "Server said no (500).",
    });
  });

  it("only connection problems are retried offline", () => {
    expect(isRetryableError(new ApiError("network", "x"))).toBe(true);
    expect(isRetryableError(new ApiError("timeout", "x"))).toBe(true);
    expect(isRetryableError(new ApiError("http", "x", 500))).toBe(false);
    expect(isRetryableError(new ApiError("forbidden", "x", 403))).toBe(false);
    expect(isRetryableError(new Error("x"))).toBe(false);
  });
});

describe("dates", () => {
  it("formats days, times and ranges without locale surprises", () => {
    expect(formatTime("18:00:00")).toBe("18:00");
    expect(formatTime(null)).toBeNull();
    expect(formatDay("2026-12-01")).toBe("Tue 1 Dec 2026");
    expect(dateBlock("2026-12-01")).toEqual({ day: "01", mon: "DEC" });
    expect(formatEventWhen({ startDate: "2026-12-01", startTime: "18:00:00", endDate: null, endTime: "21:30:00" })).toBe(
      "Tue 1 Dec 2026 · 18:00–21:30",
    );
    expect(formatEventWhen({ startDate: "2026-12-04", startTime: null, endDate: "2026-12-06", endTime: null })).toBe(
      "Fri 4 Dec 2026 – Sun 6 Dec 2026",
    );
  });

  it("today counts as upcoming; multi-day events stay upcoming until their last day", () => {
    expect(isPastEvent({ startDate: "2026-11-03", endDate: null }, NOW)).toBe(false);
    expect(isPastEvent({ startDate: "2026-11-02", endDate: null }, NOW)).toBe(true);
    expect(isPastEvent({ startDate: "2026-11-01", endDate: "2026-11-03" }, NOW)).toBe(false);
  });

  it("splits upcoming (soonest first) from past (latest first)", () => {
    const mk = (id: string, startDate: string) => ({ id, event: { startDate, endDate: null, startTime: null } });
    const { upcoming, past } = splitByWhen(
      [mk("c", "2026-12-01"), mk("a", "2026-10-01"), mk("b", "2026-11-10"), mk("z", "2026-09-01")],
      NOW,
    );
    expect(upcoming.map((x) => x.id)).toEqual(["b", "c"]);
    expect(past.map((x) => x.id)).toEqual(["a", "z"]);
  });
});

describe("canRunCheckIn (mirrors the website's canManageEvents)", () => {
  it.each(["super_admin", "admin", "events_admin"])("role %s may", (role) => {
    expect(canRunCheckIn(makeMe({ roles: [role] }))).toBe(true);
  });

  it("a direct events.manage_attendance grant may", () => {
    expect(canRunCheckIn(makeMe({ direct: ["events.manage_attendance"] }))).toBe(true);
  });

  it("the same permission only via a role bundle may not (the server refuses it too)", () => {
    expect(canRunCheckIn(makeMe({ roles: ["staff"], viaRole: ["events.manage_attendance"] }))).toBe(false);
  });

  it("other events permissions, or no account, may not", () => {
    expect(canRunCheckIn(makeMe({ direct: ["events.view", "events.create"] }))).toBe(false);
    expect(canRunCheckIn(null)).toBe(false);
  });
});
