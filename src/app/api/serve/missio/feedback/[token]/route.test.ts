import { beforeEach, describe, expect, it, vi } from "vitest";

// The house's own link still takes the house from the token, never from
// the body, now that the public link sends a houseId. Stubs only.

const h = vi.hoisted(() => ({ saved: [] as Array<{ house: { id: string } }> }));
const LINK_HOUSE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

vi.mock("@/lib/missio/availability/limit", () => ({ serveAvailabilityLimit: async () => null }));
vi.mock("@/lib/missio/feedback", () => ({
  FEEDBACK_TOKEN_PATTERN: /^[A-Za-z0-9_-]{43}$/,
  feedbackAdmin: () => ({}),
  resolveFeedbackLink: async () => ({ ok: true, houseId: LINK_HOUSE, linkId: "link-1" }),
}));
vi.mock("@/lib/missio/weekly-feedback", () => ({
  loadWeeklyHouse: async (_db: unknown, id: string) => ({ id, org_id: "o", number: 1, name: null, meeting_day: null }),
  saveWeeklyFeedback: async (_db: unknown, input: { house: { id: string } }) => {
    h.saved.push(input);
    return { ok: true, meetingDate: "2026-11-22", routes: [] };
  },
}));

import { POST } from "./route";

beforeEach(() => {
  h.saved = [];
});

describe("POST /api/serve/missio/feedback/:token", () => {
  it("ignores a houseId in the body: the house is the link's", async () => {
    const token = "a".repeat(43);
    const res = await POST(
      new Request(`http://x/api/serve/missio/feedback/${token}`, {
        method: "POST",
        body: JSON.stringify({ houseId: OTHER, answers: { attendance: 3, house_church_id: OTHER } }),
      }),
      { params: Promise.resolve({ token }) }
    );
    expect(res.status).toBe(200);
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0].house.id).toBe(LINK_HOUSE);
  });
});
