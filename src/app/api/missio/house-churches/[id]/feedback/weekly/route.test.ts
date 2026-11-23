import { beforeEach, describe, expect, it, vi } from "vitest";

// The signed-in fill still takes the house from the URL (checked against
// the user's scope and RLS), never from a houseId in the body. Stubs only.

const h = vi.hoisted(() => ({ saved: [] as Array<{ house: { id: string } }> }));
const URL_HOUSE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

vi.mock("@/lib/missio/limit", () => ({ missioRateLimit: async () => null }));
vi.mock("@/lib/missio/feedback", () => ({ feedbackAdmin: () => ({}) }));
vi.mock("@/lib/missio/house-churches", () => ({
  houseReadAccess: async () => ({ auth: { user: { id: "u1" }, supabase: {}, orgId: "org" }, scope: { mode: "ids", ids: [URL_HOUSE] } }),
  houseInScope: (scope: { ids: string[] }, id: string) => scope.ids.includes(id),
  isUuid: (v: string) => /^[0-9a-f-]{36}$/.test(v),
}));
vi.mock("@/lib/missio/weekly-feedback", () => ({
  loadWeeklyHouse: async (_db: unknown, id: string) => ({ id, org_id: "org", number: 1, name: null, meeting_day: null }),
  saveWeeklyFeedback: async (_db: unknown, input: { house: { id: string } }) => {
    h.saved.push(input);
    return { ok: true, meetingDate: "2026-11-22", routes: [] };
  },
}));

import { POST } from "./route";

const send = (id: string, body: unknown) =>
  POST(new Request(`http://x/api/missio/house-churches/${id}/feedback/weekly`, { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  h.saved = [];
});

describe("POST /api/missio/house-churches/:id/feedback/weekly", () => {
  it("saves for the URL's house whatever houseId the body carries", async () => {
    const res = await send(URL_HOUSE, { houseId: OTHER, answers: { attendance: 3 } });
    expect(res.status).toBe(200);
    expect(h.saved.map((s) => s.house.id)).toEqual([URL_HOUSE]);
  });

  it("a house outside the user's scope is not found, body or not", async () => {
    const res = await send(OTHER, { houseId: URL_HOUSE, answers: { attendance: 3 } });
    expect(res.status).toBe(404);
    expect(h.saved).toEqual([]);
  });
});
