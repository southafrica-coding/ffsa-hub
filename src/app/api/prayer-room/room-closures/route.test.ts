import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u" } as { id: string } | null,
  queries: 0,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    h.queries += 1;
    return {};
  },
}));

vi.mock("@/services/prayer-room-room-closures", () => ({
  getAuditoriumClosures: async () => ({ data: [], error: null }),
}));

import { GET } from "./route";

function call(from: string, to: string) {
  return GET(new Request(`http://localhost/api/prayer-room/room-closures?from=${from}&to=${to}`));
}

describe("GET /api/prayer-room/room-closures", () => {
  beforeEach(() => {
    h.user = { id: "u" };
    h.queries = 0;
  });

  it("returns 400 for a date that is not a real day", async () => {
    const res = await call("2026-02-30", "2026-02-30");
    expect(res.status).toBe(400);
    expect(h.queries).toBe(0);
  });

  it("returns 400 before reading bookings when the span is too long", async () => {
    const res = await call("2020-01-01", "2026-01-01");
    expect(res.status).toBe(400);
    expect(h.queries).toBe(0);
  });
});
