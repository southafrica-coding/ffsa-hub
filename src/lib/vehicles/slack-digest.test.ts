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

const fleet = { parts: ["*🔧 Inspections – <https://x/bookings/vehicles/fleet|open Fleet>*", "*Today*\n• Hyundai H1 (KVS 119 NW) – weekly check"], items: 1, slackUserIds: ["UC", "UA1"] };

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

  it("puts Fleet's sections in the one message, to the alert list and the coordinator, once each", async () => {
    expect(await sendVehicleDigest({ fleet })).toEqual({ sent: true, items: 1 });
    expect(dms.map((d) => d.user).sort()).toEqual(["UA1", "UC"]);
    const texts = dms[0].blocks.map((b) => b.text?.text);
    expect(texts).toContain(fleet.parts[0]);
    expect(texts).toContain(fleet.parts[1]);
    expect(dms[0].text).toBe("Vehicles today — 1 thing to know");
  });

  it("ignores an empty Fleet part", async () => {
    expect(await sendVehicleDigest({ fleet: { parts: [], items: 0, slackUserIds: ["UC"] } })).toEqual({ sent: false, items: 0 });
    expect(dms).toHaveLength(0);
  });
});
