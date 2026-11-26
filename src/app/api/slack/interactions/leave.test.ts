// The People Manager branch of /api/slack/interactions: the route's own
// signature check runs first, then pm_leave_ payloads go to
// lib/people-manager/slack-interactions. Everything else the route imports
// is stubbed; only the dispatch and the signature are under test.
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const h = vi.hoisted(() => ({ leave: vi.fn(), vehicle: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/slack/client", () => ({ openView: vi.fn() }));
vi.mock("@/lib/auth/prayer-room-access", () => ({ isPrayerRoomStaff: vi.fn() }));
vi.mock("@/services/prayer-room-booking-suggestions", () => ({
  getBookingSuggestions: vi.fn(),
  applyBookingSuggestion: vi.fn(),
  dismissBookingSuggestion: vi.fn(),
}));
vi.mock("@/lib/prayer-room/booking-alerts", () => ({
  ACTION_APPLY: "pr_apply",
  ACTION_DISMISS: "pr_dismiss",
  VIEW_OTHER: "pr_other",
  OTHER_VALUE: "other",
  alertKeyOf: vi.fn(),
  suggestionKeyOf: vi.fn(),
  resolveBookingAlerts: vi.fn(),
  displayName: vi.fn(),
}));
vi.mock("@/lib/vehicles/slack-alerts", () => ({ isVehicleAction: (id: string) => id.startsWith("vh_") }));
vi.mock("@/lib/vehicles/slack-interactions", () => ({
  isVehicleView: (id?: string) => id === "vh_deny_view",
  handleVehicleInteraction: (...a: unknown[]) => {
    h.vehicle(...a);
    return new NextResponse(null, { status: 200 });
  },
}));
vi.mock("@/lib/people-manager/slack-interactions", async (orig) => {
  const actual = await orig<typeof import("@/lib/people-manager/slack-interactions")>();
  return {
    ...actual,
    handleLeaveInteraction: (...a: unknown[]) => {
      h.leave(...a);
      return new NextResponse(null, { status: 200 });
    },
  };
});

const { POST } = await import("./route");

const SECRET = "test-signing-secret";
const sign = (ts: string, body: string, secret = SECRET) => "v0=" + crypto.createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex");
const form = (payload: unknown) => `payload=${encodeURIComponent(JSON.stringify(payload))}`;
const now = () => String(Math.floor(Date.now() / 1000));
function post(body: string, headers: Record<string, string>) {
  return POST(new Request("http://localhost/api/slack/interactions", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", ...headers } }));
}
const approve = { type: "block_actions", user: { id: "U_BEN" }, actions: [{ action_id: "pm_leave_approve", value: "00000000-0000-4000-8000-000000000001" }] };

beforeEach(() => {
  vi.stubEnv("SLACK_SIGNING_SECRET", SECRET);
  h.leave.mockReset();
  h.vehicle.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("/api/slack/interactions: People Manager leave", () => {
  it("routes a signed pm_leave_ click to the leave handler", async () => {
    const body = form(approve);
    const t = now();
    const res = await post(body, { "x-slack-request-timestamp": t, "x-slack-signature": sign(t, body) });
    expect(res.status).toBe(200);
    expect(h.leave).toHaveBeenCalledTimes(1);
    expect(h.leave.mock.calls[0][1]).toMatchObject(approve);
    expect(h.vehicle).not.toHaveBeenCalled();
  });

  it("routes the leave note modal too", async () => {
    const body = form({ type: "view_submission", user: { id: "U_BEN" }, view: { callback_id: "pm_leave_note_view", private_metadata: "{}", state: { values: {} } } });
    const t = now();
    await post(body, { "x-slack-request-timestamp": t, "x-slack-signature": sign(t, body) });
    expect(h.leave).toHaveBeenCalledTimes(1);
  });

  it("rejects a bad signature, a wrong secret, a missing header and a stale timestamp before dispatch", async () => {
    const body = form(approve);
    const t = now();
    const stale = String(Math.floor(Date.now() / 1000) - 60 * 6);
    for (const headers of [
      { "x-slack-request-timestamp": t, "x-slack-signature": "v0=deadbeef" },
      { "x-slack-request-timestamp": t, "x-slack-signature": sign(t, body, "someone-else") },
      { "x-slack-request-timestamp": t },
      { "x-slack-request-timestamp": stale, "x-slack-signature": sign(stale, body) },
      { "x-slack-request-timestamp": t, "x-slack-signature": sign(t, body + "&x=1") },
    ]) {
      const res = await post(body, headers as Record<string, string>);
      expect(res.status).toBe(401);
    }
    expect(h.leave).not.toHaveBeenCalled();
  });

  it("leaves vehicle clicks with the vehicle handler", async () => {
    const body = form({ type: "block_actions", user: { id: "U_X" }, actions: [{ action_id: "vh_approve", value: "b1" }] });
    const t = now();
    await post(body, { "x-slack-request-timestamp": t, "x-slack-signature": sign(t, body) });
    expect(h.vehicle).toHaveBeenCalledTimes(1);
    expect(h.leave).not.toHaveBeenCalled();
  });
});
