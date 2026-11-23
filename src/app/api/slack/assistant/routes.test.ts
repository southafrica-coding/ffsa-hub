import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Hub assistant's two Slack endpoints. The handlers they call are
// stubbed: these tests prove the routes verify the right app's signature,
// answer url_verification even when off, and do nothing at all when the
// feature is off, on a preview or for anything that isn't a DM.

const h = vi.hoisted(() => ({
  afterCallbacks: [] as (() => unknown)[],
  handled: [] as unknown[],
  confirmed: [] as unknown[],
  cancelled: [] as unknown[],
}));

vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>();
  return { ...actual, after: (fn: () => unknown) => h.afterCallbacks.push(fn) };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/slack/assistant/hub-leader/run", () => ({
  handleLeaderMessage: async (_a: unknown, msg: unknown) => h.handled.push(msg),
}));
vi.mock("@/lib/slack/assistant/hub-leader/actions", async (orig) => {
  const actual = await orig<typeof import("@/lib/slack/assistant/hub-leader/actions")>();
  return {
    ...actual,
    confirmPending: async (_a: unknown, id: string, user: string) => {
      h.confirmed.push({ id, user });
      return { text: "Done." };
    },
    cancelPending: async (_a: unknown, id: string, user: string) => {
      h.cancelled.push({ id, user });
      return { text: "Cancelled." };
    },
  };
});

const events = await import("./events/route");
const interactions = await import("./interactions/route");

const sign = (secret: string, ts: string, body: string) =>
  "v0=" + crypto.createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex");

function req(path: string, body: string, opts: { secret?: string; headers?: Record<string, string> } = {}) {
  const ts = String(Math.floor(Date.now() / 1000));
  return new Request(`https://www.ffsahub.com${path}`, {
    method: "POST",
    headers: {
      "x-slack-request-timestamp": ts,
      "x-slack-signature": sign(opts.secret ?? "assistant-secret", ts, body),
      ...opts.headers,
    },
    body,
  });
}

const dm = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "event_callback",
    event_id: "Ev1",
    event: { type: "message", channel_type: "im", channel: "D_1", user: "U_LEAD", text: "who's on my team?", ts: "1.1", ...over },
  });

const saved = { ...process.env };
function turnOn() {
  process.env.HUB_SLACK_ASSISTANT_ENABLED = "1";
  process.env.VERCEL_ENV = "production";
}

beforeEach(() => {
  h.afterCallbacks.length = 0;
  h.handled.length = 0;
  h.confirmed.length = 0;
  h.cancelled.length = 0;
  delete process.env.HUB_SLACK_ASSISTANT_ENABLED;
  delete process.env.VERCEL_ENV;
  delete process.env.PREVIEW_WRITES_DISABLED;
  process.env.SLACK_ASSISTANT_BOT_TOKEN = "xoxb-assistant";
  process.env.SLACK_ASSISTANT_SIGNING_SECRET = "assistant-secret";
  process.env.SLACK_SIGNING_SECRET = "hub-secret";
});
afterEach(() => {
  process.env = { ...saved };
});

async function runAfter() {
  for (const fn of h.afterCallbacks) await fn();
}

describe("POST /api/slack/assistant/events", () => {
  it("answers url_verification with the feature off", async () => {
    const res = await events.POST(req("/api/slack/assistant/events", JSON.stringify({ type: "url_verification", challenge: "abc" })));
    expect(await res.json()).toEqual({ challenge: "abc" });
  });

  it("answers url_verification before the signing secret is set, but nothing else", async () => {
    delete process.env.SLACK_ASSISTANT_SIGNING_SECRET;
    const ok = await events.POST(req("/api/slack/assistant/events", JSON.stringify({ type: "url_verification", challenge: "abc" })));
    expect(await ok.json()).toEqual({ challenge: "abc" });
    const bad = await events.POST(req("/api/slack/assistant/events", dm()));
    expect(bad.status).toBe(401);
  });

  it("rejects a request signed with the hub app's secret", async () => {
    turnOn();
    const res = await events.POST(req("/api/slack/assistant/events", dm(), { secret: "hub-secret" }));
    expect(res.status).toBe(401);
    expect(h.afterCallbacks).toHaveLength(0);
  });

  it("does nothing with the feature off", async () => {
    const res = await events.POST(req("/api/slack/assistant/events", dm()));
    expect(res.status).toBe(200);
    expect(h.afterCallbacks).toHaveLength(0);
  });

  it("does nothing on a preview even with the flag set", async () => {
    turnOn();
    process.env.VERCEL_ENV = "preview";
    await events.POST(req("/api/slack/assistant/events", dm()));
    expect(h.afterCallbacks).toHaveLength(0);
  });

  it("does nothing when the app's bot token is missing", async () => {
    turnOn();
    delete process.env.SLACK_ASSISTANT_BOT_TOKEN;
    await events.POST(req("/api/slack/assistant/events", dm()));
    expect(h.afterCallbacks).toHaveLength(0);
  });

  it("hands a DM to the assistant when on", async () => {
    turnOn();
    const res = await events.POST(req("/api/slack/assistant/events", dm()));
    expect(res.status).toBe(200);
    await runAfter();
    expect(h.handled).toEqual([{ slackUserId: "U_LEAD", channelId: "D_1", text: "who's on my team?", ts: "1.1", eventId: "Ev1" }]);
  });

  it("silently ignores mentions, channel messages, bots, edits and retries", async () => {
    turnOn();
    const bodies = [
      dm({ type: "app_mention", channel_type: "channel", channel: "C_1" }),
      dm({ channel_type: "channel", channel: "C_1" }),
      dm({ bot_id: "B1" }),
      dm({ subtype: "message_changed" }),
      dm({ text: "   " }),
    ];
    for (const b of bodies) {
      const res = await events.POST(req("/api/slack/assistant/events", b));
      expect(res.status).toBe(200);
    }
    const retry = await events.POST(req("/api/slack/assistant/events", dm(), { headers: { "x-slack-retry-num": "1" } }));
    expect(retry.status).toBe(200);
    expect(h.afterCallbacks).toHaveLength(0);
  });
});

describe("POST /api/slack/assistant/interactions", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const click = (action_id: string, value = id) =>
    "payload=" +
    encodeURIComponent(
      JSON.stringify({
        type: "block_actions",
        user: { id: "U_LEAD" },
        response_url: "https://hooks.slack.com/actions/T/1/x",
        actions: [{ action_id, value }],
      })
    );
  const fetchSpy = () => vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

  it("rejects a bad signature", async () => {
    turnOn();
    const res = await interactions.POST(req("/api/slack/assistant/interactions", click("hub_assistant_confirm"), { secret: "hub-secret" }));
    expect(res.status).toBe(401);
  });

  it("is a no-op with the feature off", async () => {
    await interactions.POST(req("/api/slack/assistant/interactions", click("hub_assistant_confirm")));
    expect(h.afterCallbacks).toHaveLength(0);
  });

  it("confirms with the clicker's Slack id and replaces the message", async () => {
    turnOn();
    const f = fetchSpy();
    await interactions.POST(req("/api/slack/assistant/interactions", click("hub_assistant_confirm")));
    await runAfter();
    expect(h.confirmed).toEqual([{ id, user: "U_LEAD" }]);
    expect(f).toHaveBeenCalledWith("https://hooks.slack.com/actions/T/1/x", expect.objectContaining({ method: "POST" }));
    f.mockRestore();
  });

  it("cancels", async () => {
    turnOn();
    const f = fetchSpy();
    await interactions.POST(req("/api/slack/assistant/interactions", click("hub_assistant_cancel")));
    await runAfter();
    expect(h.cancelled).toEqual([{ id, user: "U_LEAD" }]);
    f.mockRestore();
  });

  it("ignores a button value that isn't a pending id", async () => {
    turnOn();
    await interactions.POST(req("/api/slack/assistant/interactions", click("hub_assistant_confirm", "u-amy|records_library.manage")));
    expect(h.afterCallbacks).toHaveLength(0);
  });
});
