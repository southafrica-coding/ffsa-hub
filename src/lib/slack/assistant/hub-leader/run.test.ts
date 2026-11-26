import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeState } from "./testing";
import type { HubState } from "./testing-hub";

const h = vi.hoisted(() => ({
  state: {} as FakeState,
  hub: {} as HubState,
  slackToHub: {} as Record<string, string>,
  posts: [] as { channel: string; text: string; blocks?: unknown[]; bot?: string }[],
  replies: [] as unknown[],
  calls: [] as { model: string; messages: unknown[]; tools: { name: string }[]; system: string }[],
  history: [] as unknown[],
  logged: [] as unknown[],
}));

vi.mock("./data", async () => (await import("./testing")).makeFakeData(h.state));
vi.mock("./hub-data", async () => (await import("./testing-hub")).makeFakeHub(h.hub));
vi.mock("@/services/slack-bot", () => ({
  resolveHubUserBySlackId: async (_a: unknown, slackId: string) => h.slackToHub[slackId] ?? null,
  logSlackBotQuery: async (_a: unknown, row: unknown) => {
    h.logged.push(row);
    return { error: null };
  },
}));
vi.mock("@/lib/slack/client", () => ({
  postMessage: async (args: { channel: string; text: string; blocks?: unknown[]; bot?: string }) => {
    h.posts.push(args);
    return { ok: true };
  },
  conversationHistory: async () => ({ ok: true, messages: h.history }),
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async (req: { model: string; messages: unknown[]; tools: { name: string }[]; system: string }) => {
        h.calls.push({ ...req, messages: [...req.messages] });
        const next = h.replies.shift();
        if (!next) throw new Error("no scripted reply");
        return next;
      },
    };
  },
}));

const { baseState } = await import("./testing");
const { handleLeaderMessage, toMessages, NOT_LEADER_REPLY, UNLINKED_REPLY, UNAVAILABLE_REPLY, HAIKU_MODEL } = await import("./run");

const msg = (text: string, slackUserId = "U_LEAD") => ({ slackUserId, channelId: "D_1", text, ts: "1700000000.000100", eventId: "Ev1" });
const toolUse = (name: string, input: Record<string, unknown>) => ({ content: [{ type: "tool_use", id: `tu_${name}`, name, input }] });
const say = (text: string) => ({ content: [{ type: "text", text }] });
const saved = { ...process.env };

beforeEach(async () => {
  for (const k of Object.keys(h.state)) delete (h.state as Record<string, unknown>)[k];
  Object.assign(h.state, baseState());
  for (const k of Object.keys(h.hub)) delete (h.hub as Record<string, unknown>)[k];
  Object.assign(h.hub, (await import("./testing-hub")).baseHubState());
  h.slackToHub = { U_LEAD: "u-lead", U_AMY: "u-amy" };
  h.posts.length = 0;
  h.replies.length = 0;
  h.calls.length = 0;
  h.history = [];
  h.logged.length = 0;
  process.env.ANTHROPIC_API_KEY = "test-key";
});
afterEach(() => {
  process.env = { ...saved };
});

describe("handleLeaderMessage — the gate", () => {
  it("refuses an unlinked Slack user without calling the model", async () => {
    await handleLeaderMessage({}, msg("hi", "U_STRANGER"));
    expect(h.posts).toEqual([{ channel: "D_1", text: UNLINKED_REPLY, blocks: undefined, bot: "assistant" }]);
    expect(h.calls).toHaveLength(0);
  });

  it("refuses a Hub user who isn't a ministry leader", async () => {
    await handleLeaderMessage({}, msg("hi", "U_AMY"));
    expect(h.posts.map((p) => p.text)).toEqual([NOT_LEADER_REPLY]);
    expect(h.calls).toHaveLength(0);
  });

  it("says it's unavailable, without naming any setting, when the model key is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await handleLeaderMessage({}, msg("hi"));
    expect(h.posts.map((p) => p.text)).toEqual([UNAVAILABLE_REPLY]);
    expect(UNAVAILABLE_REPLY).not.toMatch(/ANTHROPIC|API|KEY|env/i);
    expect(h.calls).toHaveLength(0);
  });
});

describe("handleLeaderMessage — the tool loop", () => {
  it("answers with the allowlisted tools only, on the Hub bot, and logs the question", async () => {
    h.replies.push(toolUse("list_team_access", {}), say("You lead *Worship*: Amy, Ben and you."));
    await handleLeaderMessage({}, msg("who's on my team?"));
    expect(h.calls[0].model).toBe(HAIKU_MODEL);
    expect(h.calls[0].tools.map((t) => t.name).sort()).toEqual(
      [
        "check_hire_stock",
        "check_vehicle_availability",
        "decide_request",
        "find_contact",
        "grant_permission",
        "list_forms",
        "list_pending_approvals",
        "list_space_bookings",
        "list_team_access",
        "list_vehicle_bookings",
        "lookup_person_access",
        "report_problem",
        "request_vehicle_booking",
        "resend_invite",
        "revoke_permission",
        "search_hub_help",
        "update_contact",
      ]
    );
    expect(h.calls[0].system).toContain("Worship");
    expect(h.posts).toEqual([expect.objectContaining({ channel: "D_1", bot: "assistant", text: "You lead *Worship*: Amy, Ben and you." })]);
    expect(h.logged).toHaveLength(1);
  });

  it("posts a proposed grant with Confirm / Cancel and writes nothing", async () => {
    h.replies.push(toolUse("grant_permission", { person: "Amy", permission_key: "events.view" }), say("I've set that up — press Confirm."));
    await handleLeaderMessage({}, msg("give amy events.view"));
    expect(h.state.grants).toHaveLength(0);
    expect(h.state.pending).toHaveLength(1);
    expect(h.posts).toHaveLength(2);
    const card = h.posts[1];
    expect(card.bot).toBe("assistant");
    const actions = (card.blocks as { type: string; elements?: { value: string }[] }[]).find((b) => b.type === "actions")!;
    expect(actions.elements!.map((e) => e.value)).toEqual([h.state.pending[0].id, h.state.pending[0].id]);
  });

  it("refuses a tool the model invents", async () => {
    h.replies.push(toolUse("run_readonly_query", { sql: "delete from users" }), say("I can't do that."));
    await handleLeaderMessage({}, msg("run some sql"));
    const toolResult = (h.calls[1].messages.at(-1) as { content: { content: string }[] }).content[0].content;
    expect(toolResult).toContain("That isn't something I can do.");
  });

  it("replies with a plain error if the model call fails", async () => {
    await handleLeaderMessage({}, msg("hello"));
    expect(h.posts.map((p) => p.text)).toEqual([expect.stringMatching(/Something went wrong/)]);
  });
});

describe("toMessages", () => {
  it("turns the DM history into alternating turns ending with the new message", () => {
    const out = toMessages(
      [
        { ts: "3", user: "U", text: "the new one" },
        { ts: "2", bot_id: "B", text: "Which Amy?" },
        { ts: "1", user: "U", text: "give amy events.view" },
        { ts: "0.5", bot_id: "B", text: "older bot line" },
        { ts: "0.4", user: "U", subtype: "channel_join", text: "joined" },
      ],
      { ts: "3", text: "Amy Adams" }
    );
    expect(out).toEqual([
      { role: "user", content: "give amy events.view" },
      { role: "assistant", content: "Which Amy?" },
      { role: "user", content: "Amy Adams" },
    ]);
  });
});
