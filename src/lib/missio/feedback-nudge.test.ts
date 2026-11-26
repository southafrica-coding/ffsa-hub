import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => null }));
vi.mock("@/lib/slack/client", () => ({
  openConversation: () => {
    throw new Error("real Slack client called");
  },
  postMessage: () => {
    throw new Error("real Slack client called");
  },
  updateMessage: () => {
    throw new Error("real Slack client called");
  },
}));

import { missioWeeklyFeedbackFormRow } from "@/lib/forms/templates/missio-weekly-feedback";
import { isNudgeTime, runFeedbackNudge } from "./feedback-nudge";

type Query = { table: string; op: string; payload?: Record<string, unknown> };
let queries: Query[];
let claims: Set<string>;

const SUNDAY_6PM = new Date("2026-11-22T16:00:00Z"); // 18:00 SAST
const SUNDAY_5PM = new Date("2026-11-22T15:00:00Z");
const LIVE = {
  VERCEL_ENV: "production",
  HUB_FORMS_SLACK_ENABLED: "1",
  HUB_FORMS_NUDGE_ENABLED: "1",
  SLACK_BOT_TOKEN: "x",
} as unknown as NodeJS.ProcessEnv;

function answer(q: Query) {
  switch (q.table) {
    case "forms":
      return { id: "form-1", ...missioWeeklyFeedbackFormRow() };
    case "organisations":
      return { id: "org-missio" };
    case "house_churches":
      return [
        { id: "h1", number: 1, meeting_day: null },
        { id: "h2", number: 2, meeting_day: null },
      ];
    case "missio_house_feedback":
      return [{ house_church_id: "h1", meeting_date: "2026-11-22" }];
    case "house_church_members":
      return [{ contact_id: "c-leader" }];
    case "users":
      return [{ id: "u-leader", slack_user_id: "ULEADER" }];
    case "form_route_slack_messages": {
      if (q.op !== "insert") return null;
      const key = `${q.payload?.subject_id}|${q.payload?.period_key}|${q.payload?.recipient_user_id}`;
      if (claims.has(key)) return null;
      claims.add(key);
      return { id: "claim-1" };
    }
    default:
      return null;
  }
}

function fakeDb() {
  return {
    from(table: string) {
      const q: Query = { table, op: "select" };
      const b: Record<string, unknown> = {};
      const chain = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => (fn(...a), b);
      b.select = chain(() => {});
      b.insert = chain((p) => Object.assign(q, { op: "insert", payload: p }));
      b.update = chain((p) => Object.assign(q, { op: "update", payload: p }));
      b.delete = chain(() => Object.assign(q, { op: "delete" }));
      for (const op of ["eq", "is", "in", "gt", "order"]) b[op] = chain(() => {});
      b.maybeSingle = chain(() => {});
      b.single = chain(() => {});
      b.then = (resolve: (v: unknown) => unknown) => {
        queries.push(q);
        const data = answer(q);
        return Promise.resolve({ data, error: q.op === "insert" && !data ? { code: "23505" } : null }).then(resolve);
      };
      return b;
    },
  };
}

const slack = {
  openConversation: vi.fn(async (user: string) => ({ ok: true, channel: { id: `D-${user}` } })),
  postMessage: vi.fn(async (args: { channel: string }) => ({ ok: true, ts: "1.0", channel: args.channel })),
  updateMessage: vi.fn(async () => ({ ok: true })),
};

beforeEach(() => {
  queries = [];
  claims = new Set();
  slack.openConversation.mockClear();
  slack.postMessage.mockClear();
});

describe("runFeedbackNudge", () => {
  it("is off by default: no database read and no Slack call", async () => {
    for (const env of [
      {},
      { VERCEL_ENV: "production", HUB_FORMS_NUDGE_ENABLED: "1" }, // Slack flag off
      { VERCEL_ENV: "preview", HUB_FORMS_NUDGE_ENABLED: "1", HUB_FORMS_SLACK_ENABLED: "1" },
      { VERCEL_ENV: "production", HUB_FORMS_SLACK_ENABLED: "1" }, // nudge flag off
    ]) {
      const r = await runFeedbackNudge(fakeDb(), { env: env as unknown as NodeJS.ProcessEnv, now: SUNDAY_6PM, slack, force: true });
      expect(r.status).toBe("off");
    }
    expect(queries).toEqual([]);
    expect(slack.postMessage).not.toHaveBeenCalled();
  });

  it("only runs from Sunday 18:00 SAST unless a pastor presses the button", async () => {
    expect(isNudgeTime(SUNDAY_6PM)).toBe(true);
    expect(isNudgeTime(SUNDAY_5PM)).toBe(false);
    expect(isNudgeTime(new Date("2026-11-23T16:00:00Z"))).toBe(false);
    expect((await runFeedbackNudge(fakeDb(), { env: LIVE, now: SUNDAY_5PM, slack })).status).toBe("not_time");
    expect(queries).toEqual([]);
  });

  it("when on, DMs the leaders of houses that have not sent, once per week", async () => {
    const r = await runFeedbackNudge(fakeDb(), { env: LIVE, now: SUNDAY_6PM, slack });
    expect(r).toMatchObject({ status: "done", missing: [2], sent: 1 });
    expect(slack.openConversation).toHaveBeenCalledWith("ULEADER");
    const msg = slack.postMessage.mock.calls[0][0] as unknown as { channel: string; text: string };
    expect(msg.channel).toBe("D-ULEADER");
    expect(msg.text).toContain("House 2");

    const again = await runFeedbackNudge(fakeDb(), { env: LIVE, now: SUNDAY_6PM, slack, force: true });
    expect(again).toMatchObject({ sent: 0, skipped: 1 });
    expect(slack.postMessage).toHaveBeenCalledTimes(1);
  });
});
