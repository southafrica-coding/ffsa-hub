import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/mobile/training/checkins: validates, saves as the caller through
// migration 336, maps an RLS refusal to 403, and tells people only when the
// save newly raised "needs care".

const state = vi.hoisted(() => ({
  user: { id: "daniel" } as { id: string } | null,
  rpc: { data: [{ checkin_id: "c1", newly_needs_care: false }], error: null } as { data: unknown; error: unknown },
}));

const userClient = { tag: "user-client" };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => userClient }));
vi.mock("@/lib/api-auth", () => ({ getAuthedUser: async () => state.user }));
vi.mock("@/services/training", () => ({ saveCheckin: vi.fn(async () => state.rpc) }));
vi.mock("@/lib/training/care-notify", () => ({ notifyNeedsCare: vi.fn(async () => ({ recipients: 2, slack: 1, push: true })) }));

import { notifyNeedsCare } from "@/lib/training/care-notify";
import { saveCheckin } from "@/services/training";
import { POST } from "./route";

const E1 = "e1000000-0000-4000-8000-000000000001";
const post = (body: unknown) =>
  POST(new Request("https://hub.test/api/mobile/training/checkins", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  state.user = { id: "daniel" };
  state.rpc = { data: [{ checkin_id: "c1", newly_needs_care: false }], error: null };
  vi.mocked(saveCheckin).mockClear();
  vi.mocked(notifyNeedsCare).mockClear();
});

describe("POST /api/mobile/training/checkins", () => {
  it("401 when signed out", async () => {
    state.user = null;
    expect((await post({})).status).toBe(401);
  });

  it("400 with a plain message for a bad body, nothing saved", async () => {
    const res = await post({ enrollmentId: E1, contact: "met" });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/hard, okay, good or great/);
    expect(saveCheckin).not.toHaveBeenCalled();
  });

  it("saves with the caller's own client for this week's Monday", async () => {
    const res = await post({ enrollmentId: E1, contact: "met", mood: "okay", noteStaffOnly: "x" });
    expect(res.status).toBe(200);
    const [client, input, week] = vi.mocked(saveCheckin).mock.calls[0];
    expect(client).toBe(userClient);
    expect(input).toMatchObject({ enrollmentId: E1, contact: "met", mood: "okay", noteStaffOnly: "x", needsCare: false });
    expect(week).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${week}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(notifyNeedsCare).not.toHaveBeenCalled();
  });

  it("tells people when care is newly raised", async () => {
    state.rpc = { data: [{ checkin_id: "c9", newly_needs_care: true }], error: null };
    await post({ enrollmentId: E1, contact: "met", mood: "hard", needsCare: true });
    expect(notifyNeedsCare).toHaveBeenCalledWith(expect.objectContaining({ checkinId: "c9", enrollmentId: E1, authorId: "daniel" }));
  });

  it("403 when RLS refuses", async () => {
    state.rpc = { data: null, error: { code: "42501", message: "new row violates row-level security policy" } };
    const res = await post({ enrollmentId: E1, contact: "met", mood: "good" });
    expect(res.status).toBe(403);
    expect(notifyNeedsCare).not.toHaveBeenCalled();
  });
});
