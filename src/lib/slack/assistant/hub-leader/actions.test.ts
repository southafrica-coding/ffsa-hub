import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeState } from "./testing";

const h = vi.hoisted(() => ({
  state: {} as FakeState,
  slackToHub: {} as Record<string, string>,
  sent: [] as Record<string, unknown>[],
  sendResult: { ok: true } as { ok: boolean; error?: string; suppressed?: boolean },
}));

vi.mock("./data", async () => (await import("./testing")).makeFakeData(h.state));
vi.mock("@/services/slack-bot", () => ({
  resolveHubUserBySlackId: async (_a: unknown, slackId: string) => h.slackToHub[slackId] ?? null,
}));
vi.mock("@/lib/auth/send-setup-link", () => ({
  sendSetupLink: async (_a: unknown, args: Record<string, unknown>) => {
    h.sent.push(args);
    return h.sendResult;
  },
}));
vi.mock("@/lib/email/templates/invite", () => ({ inviteEmailHtml: () => "<p>invite</p>" }));
vi.mock("@/lib/slack/client", () => ({ postMessage: async () => ({ ok: true }) }));

const { baseState, MINISTRY_WORSHIP } = await import("./testing");
const { executeHubLeaderTool } = await import("./tools");
const { cancelPending, confirmationBlocks, confirmPending, isPendingId, ACTION_CONFIRM, ACTION_CANCEL } = await import("./actions");

const leader = { hubUserId: "u-lead", slackUserId: "U_LEAD", ministries: [{ id: MINISTRY_WORSHIP, name: "Worship" }] };

async function propose(name: string, input: Record<string, unknown>) {
  const out = await executeHubLeaderTool({ admin: {}, leader, channelId: "D_LEAD" }, name, input);
  if (!out.proposal) throw new Error(`no proposal: ${JSON.stringify(out.output)}`);
  return out.proposal.pendingId;
}

beforeEach(() => {
  for (const k of Object.keys(h.state)) delete (h.state as Record<string, unknown>)[k];
  Object.assign(h.state, baseState());
  h.slackToHub = { U_LEAD: "u-lead", U_AMY: "u-amy" };
  h.sent.length = 0;
  h.sendResult = { ok: true };
});

describe("confirmationBlocks", () => {
  it("carries only the pending id on the buttons", () => {
    const blocks = confirmationBlocks("Give *Amy* View events?", "00000000-0000-4000-8000-000000000001") as {
      type: string;
      elements?: { action_id: string; value: string }[];
    }[];
    const buttons = blocks.find((b) => b.type === "actions")!.elements!;
    expect(buttons.map((b) => b.action_id)).toEqual([ACTION_CONFIRM, ACTION_CANCEL]);
    expect(buttons.every((b) => b.value === "00000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isPendingId(buttons[0].value)).toBe(true);
    expect(isPendingId("u-amy|events.view")).toBe(false);
  });
});

describe("confirmPending — grant", () => {
  it("writes the grant only on Confirm, then audits both trails", async () => {
    const id = await propose("grant_permission", { person: "Amy", permission_key: "events.view" });
    expect(h.state.grants).toHaveLength(0);

    const res = await confirmPending({}, id, "U_LEAD");
    expect(res.text).toMatch(/^Done/);
    expect(h.state.grants).toEqual([
      { userId: "u-amy", permissionId: "p-events-view", grantedBy: "u-lead", scopeType: null, scopeId: null },
    ]);
    expect(h.state.hubAudit).toEqual([
      expect.objectContaining({
        user_id: "u-lead",
        action: "grant_permission",
        resource_type: "user_permissions",
        resource_id: "u-amy",
        changes: expect.objectContaining({ source: "slack_hub_assistant", permission_key: "events.view", pending_action_id: id }),
      }),
    ]);
    expect(h.state.audit.map((a) => a.result)).toEqual(["proposed", "executed"]);
    expect(h.state.pending[0].consumed_at).not.toBeNull();
  });

  it("does nothing on a replayed or double click", async () => {
    const id = await propose("grant_permission", { person: "Amy", permission_key: "events.view" });
    await confirmPending({}, id, "U_LEAD");
    h.state.direct = h.state.direct.filter((d) => !(d.user_id === "u-amy")); // even if the grant was since removed
    const again = await confirmPending({}, id, "U_LEAD");
    expect(again.text).toMatch(/expired or was already handled/);
    expect(h.state.grants).toHaveLength(1);
  });

  it("does nothing once expired", async () => {
    const id = await propose("grant_permission", { person: "Amy", permission_key: "events.view" });
    h.state.pending[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const res = await confirmPending({}, id, "U_LEAD");
    expect(res.text).toMatch(/expired/);
    expect(h.state.grants).toHaveLength(0);
  });

  it("does nothing after Cancel", async () => {
    const id = await propose("grant_permission", { person: "Amy", permission_key: "events.view" });
    expect((await cancelPending({}, id, "U_LEAD")).text).toMatch(/Cancelled/);
    expect((await confirmPending({}, id, "U_LEAD")).text).toMatch(/already handled/);
    expect(h.state.grants).toHaveLength(0);
    expect(h.state.audit.map((a) => a.result)).toEqual(["proposed", "cancelled"]);
  });

  it("only the leader who asked can confirm or cancel", async () => {
    const id = await propose("grant_permission", { person: "Amy", permission_key: "events.view" });
    expect((await confirmPending({}, id, "U_AMY")).text).toMatch(/Only the person who asked/);
    expect((await cancelPending({}, id, "U_AMY")).text).toMatch(/Only the person who asked/);
    expect(h.state.grants).toHaveLength(0);
    expect(h.state.pending[0].consumed_at).toBeNull();
    expect(h.state.pending[0].cancelled_at).toBeNull();
  });

  it("refuses if the Slack account now points at someone else", async () => {
    const id = await propose("grant_permission", { person: "Amy", permission_key: "events.view" });
    h.slackToHub.U_LEAD = "u-ben";
    expect((await confirmPending({}, id, "U_LEAD")).text).toMatch(/didn't make that change/);
    expect(h.state.grants).toHaveLength(0);
  });

  it("re-checks leadership on Confirm", async () => {
    const id = await propose("grant_permission", { person: "Amy", permission_key: "events.view" });
    h.state.memberships = h.state.memberships.filter((m) => m.member_role !== "leader");
    const res = await confirmPending({}, id, "U_LEAD");
    expect(res.text).toMatch(/only available to ministry leaders/);
    expect(h.state.grants).toHaveLength(0);
    expect(h.state.audit.at(-1)).toMatchObject({ result: "refused" });
  });

  it("re-checks the leader still holds the permission", async () => {
    const id = await propose("grant_permission", { person: "Amy", permission_key: "events.view" });
    h.state.direct = h.state.direct.filter((d) => !(d.user_id === "u-lead" && d.key === "events.view"));
    expect((await confirmPending({}, id, "U_LEAD")).text).toMatch(/don't hold/);
    expect(h.state.grants).toHaveLength(0);
  });

  it("re-checks the person is still on the team", async () => {
    const id = await propose("grant_permission", { person: "Amy", permission_key: "events.view" });
    h.state.memberships = h.state.memberships.filter((m) => m.user_id !== "u-amy");
    expect((await confirmPending({}, id, "U_LEAD")).text).toMatch(/couldn't match/);
    expect(h.state.grants).toHaveLength(0);
  });

  it("re-checks a tampered payload rather than trusting it", async () => {
    const id = await propose("grant_permission", { person: "Amy", permission_key: "events.view" });
    h.state.pending[0].payload = { target_user_id: "u-amy", permission_key: "records_library.manage" };
    expect((await confirmPending({}, id, "U_LEAD")).text).toMatch(/can't hand out/);
    h.state.pending.push({ ...h.state.pending[0], id: "00000000-0000-4000-8000-0000000000ff", cancelled_at: null, payload: { target_user_id: "u-out", permission_key: "events.view" } });
    expect((await confirmPending({}, "00000000-0000-4000-8000-0000000000ff", "U_LEAD")).text).toMatch(/couldn't match/);
    expect(h.state.grants).toHaveLength(0);
  });

  it("knows nothing about a made-up id", async () => {
    expect((await confirmPending({}, "00000000-0000-4000-8000-00000000abcd", "U_LEAD")).text).toMatch(/expired or was already handled/);
  });
});

describe("confirmPending — revoke", () => {
  it("removes the direct grant on Confirm", async () => {
    const id = await propose("revoke_permission", { person: "Ben", permission_key: "events.view" });
    expect(h.state.revokes).toHaveLength(0);
    expect((await confirmPending({}, id, "U_LEAD")).text).toMatch(/^Done/);
    expect(h.state.revokes).toEqual([{ userId: "u-ben", permissionId: "p-events-view", scopeType: null, scopeId: null }]);
    expect(h.state.hubAudit[0]).toMatchObject({ action: "revoke_permission", resource_id: "u-ben" });
  });
});

describe("confirmPending — resend invite", () => {
  it("sends through sendSetupLink, recording the leader and the assistant", async () => {
    const id = await propose("resend_invite", { person: "Amy" });
    expect(h.sent).toHaveLength(0);
    expect((await confirmPending({}, id, "U_LEAD")).text).toMatch(/resent the Hub invite to Amy Adams/);
    expect(h.sent).toEqual([
      expect.objectContaining({
        userId: "u-amy",
        email: "amy@example.test",
        createdBy: "u-lead",
        reason: expect.stringContaining("Slack Hub assistant"),
      }),
    ]);
    expect(h.state.hubAudit[0]).toMatchObject({ user_id: "u-lead", action: "resend_invite", resource_id: "u-amy" });
  });

  it("refuses on Confirm if they've set a password since", async () => {
    const id = await propose("resend_invite", { person: "Amy" });
    h.state.users.find((u) => u.id === "u-amy")!.has_password = true;
    expect((await confirmPending({}, id, "U_LEAD")).text).toMatch(/already finished/);
    expect(h.sent).toHaveLength(0);
  });

  it("reports a bounced address plainly", async () => {
    const id = await propose("resend_invite", { person: "Amy" });
    h.sendResult = { ok: false, error: "suppressed", suppressed: true };
    expect((await confirmPending({}, id, "U_LEAD")).text).toMatch(/bounced/);
    expect(h.state.hubAudit).toHaveLength(0);
    expect(h.state.audit.at(-1)).toMatchObject({ result: "failed" });
  });
});
