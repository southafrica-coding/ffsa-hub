// The 07:00 vehicle digest carries Fleet's checks in the same Slack message (Jack,
// 18 Nov 2026), and a Fleet failure never stops the bookings digest.

import { afterEach, describe, expect, it, vi } from "vitest";

const digests: unknown[] = [];
let fleetResult: unknown = { outcome: "sent", bookingParts: [], fleetParts: ["*🔧 FLEET*", "🟢 *IN*  *H1*\n• Weekly check due today"], items: 1, slackUserIds: ["U1"] };

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/fleet/reminder-send", () => ({
  fleetDigestPart: vi.fn(async () => {
    if (fleetResult instanceof Error) throw fleetResult;
    return fleetResult;
  }),
}));
vi.mock("@/lib/vehicles/slack-alerts", () => ({
  sendVehicleDigest: vi.fn(async (opts: unknown) => (digests.push(opts), { sent: true, items: 3 })),
}));

import { GET } from "./route";

const call = () => GET(new Request("http://x", { headers: { authorization: "Bearer s3cret" } }));

afterEach(() => {
  digests.length = 0;
  vi.unstubAllEnvs();
});

describe("GET /api/cron/vehicle-slack-digest", () => {
  it("refuses a call without the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await GET(new Request("http://x"));
    expect(res.status).toBe(401);
    expect(digests).toHaveLength(0);
  });

  it("refuses every call when CRON_SECRET isn't set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(new Request("http://x", { headers: { authorization: "Bearer " } }));
    expect(res.status).toBe(401);
    expect(digests).toHaveLength(0);
  });

  it("hands Fleet's part to the one digest message", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await call();
    expect(await res.json()).toMatchObject({ ok: true, sent: true, fleet: "sent" });
    expect(digests).toEqual([{ fleet: fleetResult }]);
  });

  it("still sends the bookings digest when Fleet fails", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    fleetResult = new Error("fleet down");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call();
    expect(await res.json()).toMatchObject({ ok: true, sent: true, fleet: "failed" });
    expect(digests).toEqual([{ fleet: null }]);
  });
});
