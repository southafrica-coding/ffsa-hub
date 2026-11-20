// The 07:00 digest with Fleet's checks merged in: one message, to the alert list plus
// the Vehicle Coordinator(s), each once. Slack is mocked: no test can message anyone.

import { beforeEach, describe, expect, it, vi } from "vitest";

const dms: { user: string; text: string; blocks: { text?: { text: string } }[] }[] = [];
let alertIds: string[] = [];
const slackIds: Record<string, string> = { a1: "UA1", coord: "UC" };

vi.mock("@/lib/slack/client", () => ({
  openConversation: vi.fn(async (user: string) => ({ ok: true, channel: { id: "D-" + user } })),
  postMessage: vi.fn(async (m: { channel: string; text: string; blocks: never[] }) => {
    dms.push({ user: m.channel.slice(2), text: m.text, blocks: m.blocks });
    return { ok: true, ts: "1" };
  }),
}));

// Every booking query comes back empty, so only Fleet has anything to say.
function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "lt", "gte", "lte", "in", "order"]) c[m] = () => c;
  c.maybeSingle = async () => result;
  c.then = (res: (v: unknown) => unknown) => res(result);
  return c;
}
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) =>
      t === "vehicle_alert_settings"
        ? chain({ data: { slack_alert_user_ids: alertIds } })
        : t === "users"
          ? chain({ data: alertIds.map((id) => ({ id, slack_user_id: slackIds[id] })) })
          : chain({ data: [] }),
  }),
}));

import { sendVehicleDigest } from "./slack-alerts";

const fleet = {
  bookingParts: ["*⚠️ Clashes (1) – <https://x/bookings/vehicles/fleet/calendar|sort them out on the Calendar>*\n• Kombi: Service clashes with HULC"],
  fleetParts: ["*🔧 FLEET – <https://x/bookings/vehicles/fleet|open Fleet>*", "🟢 *IN*  *Hyundai H1 (KVS 119 NW)*\n• Weekly check due today", "🔴 *OUT*  *Kombi*\nHULC · Jane Doe, back 21 Nov"],
  items: 2,
  slackUserIds: ["UC", "UA1"],
};

beforeEach(() => {
  dms.length = 0;
  alertIds = ["a1"];
  vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
});

describe("sendVehicleDigest with Fleet", () => {
  it("sends nothing on a quiet day", async () => {
    expect(await sendVehicleDigest()).toEqual({ sent: false, items: 0 });
    expect(dms).toHaveLength(0);
  });

  it("sends one message in two parts, BOOKINGS then FLEET, to the alert list and the coordinator, once each", async () => {
    expect(await sendVehicleDigest({ fleet })).toEqual({ sent: true, items: 2 });
    expect(dms.map((d) => d.user).sort()).toEqual(["UA1", "UC"]);
    const texts = dms[0].blocks.map((b) => b.text?.text ?? "—");
    const at = (s: string) => texts.findIndex((t) => t.includes(s));
    expect(at("📅 BOOKINGS")).toBeGreaterThan(0);
    expect(at("Clashes (1)")).toBeGreaterThan(at("📅 BOOKINGS"));
    expect(at("🔧 FLEET")).toBeGreaterThan(at("Clashes (1)"));
    expect(texts).toContain(fleet.fleetParts[1]);
    expect(texts).toContain(fleet.fleetParts[2]);
    expect(dms[0].text).toBe("Vehicles today — 2 things to know");
  });

  it("lists the vehicles even when nothing is due, and says bookings are quiet", async () => {
    const quiet = { ...fleet, bookingParts: [], items: 0 };
    expect(await sendVehicleDigest({ fleet: quiet })).toEqual({ sent: true, items: 0 });
    const texts = dms[0].blocks.map((b) => b.text?.text);
    expect(texts).toContain("Nothing on bookings today.");
    expect(texts).toContain(fleet.fleetParts[2]);
  });

  it("with Fleet off, the bookings digest is unchanged (no BOOKINGS heading) and a quiet day sends nothing", async () => {
    expect(await sendVehicleDigest({ fleet: { bookingParts: [], fleetParts: [], items: 0, slackUserIds: ["UC"] } })).toEqual({ sent: false, items: 0 });
    expect(dms).toHaveLength(0);
  });
});
