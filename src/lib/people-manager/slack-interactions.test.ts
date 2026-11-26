import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryDb } from "@/lib/l10/testing/memory-db";
import { ADA, BEN, GINA, GROUNDS_ID, MIA, PROD_ENV, PW_ID, SIPHO, T_GROUNDS_SICK, T_SICK, ZOE, makeWorld, seedRequest, serviceClient, tick } from "./testing/world";
import type { LeaveSlackDeps } from "@/lib/slack/leave-approval";

const h = vi.hoisted(() => ({ after: [] as (() => Promise<unknown>)[], views: [] as { trigger: string; view: { callback_id: string; private_metadata: string } }[] }));
vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>();
  return { ...actual, after: (fn: () => Promise<unknown>) => h.after.push(fn) };
});
vi.mock("@/lib/slack/client", () => ({
  openView: vi.fn(async (trigger: string, view: never) => {
    h.views.push({ trigger, view });
    return { ok: true };
  }),
}));

const { handleLeaveInteraction, isLeaveInteraction } = await import("./slack-interactions");

let db: MemoryDb;
let told: { url: string; text: string }[];
let dms: string[];
const slackDeps: LeaveSlackDeps = {
  sendSlackDm: async (to) => {
    dms.push(to);
    return { ok: true, channel: `D_${to}`, ts: "1.1" };
  },
  updateMessage: async () => ({ ok: true }),
  slackReady: () => true,
  now: () => new Date(tick()),
  log: () => {},
};
const deps = { slack: slackDeps, env: PROD_ENV };

const runAfter = async () => {
  while (h.after.length) await h.after.shift()!();
};
const click = (slackUser: string, action: string, requestId: string, extra: Record<string, unknown> = {}) => ({
  type: "block_actions",
  user: { id: slackUser },
  trigger_id: `trig-${slackUser}`,
  response_url: `https://hooks.slack.test/${slackUser}`,
  actions: [{ action_id: action, value: requestId }],
  ...extra,
});
const submit = (slackUser: string, requestId: string, decision: string, note: string | null) => ({
  type: "view_submission",
  user: { id: slackUser },
  view: { callback_id: "pm_leave_note_view", private_metadata: JSON.stringify({ id: requestId, decision }), state: { values: { note: { note: { value: note } } } } },
});
const row = (id: unknown) => db.tables.leave_requests.find((r) => r.id === id)!;

beforeEach(() => {
  db = makeWorld();
  h.after = [];
  h.views = [];
  told = [];
  dms = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      told.push({ url, text: JSON.parse(init.body).text });
      return new Response("ok");
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

const pending = () => seedRequest(db, { requester_id: SIPHO, department_id: PW_ID, leave_type_id: T_SICK, start_date: "2026-11-26", end_date: "2026-12-01" });

describe("isLeaveInteraction", () => {
  it("claims only pm_leave_ actions and the note modal", () => {
    expect(isLeaveInteraction({ type: "block_actions", actions: [{ action_id: "pm_leave_approve" }] })).toBe(true);
    expect(isLeaveInteraction({ type: "view_submission", view: { callback_id: "pm_leave_note_view" } })).toBe(true);
    expect(isLeaveInteraction({ type: "block_actions", actions: [{ action_id: "vh_approve" }] })).toBe(false);
    expect(isLeaveInteraction({ type: "view_submission", view: { callback_id: "vh_deny_view" } })).toBe(false);
  });
});

describe("Approve", () => {
  it("approves, DMs the requester and settles the cards", async () => {
    const r = pending();
    const res = await handleLeaveInteraction(serviceClient(db), click("U_BEN", "pm_leave_approve", String(r.id)), deps);
    expect(res.status).toBe(200);
    await runAfter();
    expect(row(r.id)).toMatchObject({ status: "approved", decided_by: BEN, decision_note: null });
    expect(dms).toEqual(["U_SIPHO"]);
  });

  it("first decision wins when two leaders click at once; the other is told who decided", async () => {
    const r = pending();
    const admin = serviceClient(db);
    await Promise.all([
      handleLeaveInteraction(admin, click("U_BEN", "pm_leave_approve", String(r.id)), deps),
      handleLeaveInteraction(admin, click("U_MIA", "pm_leave_approve", String(r.id)), deps),
    ]);
    await Promise.all(h.after.splice(0).map((fn) => fn()));
    const winner = row(r.id).decided_by;
    expect([BEN, MIA]).toContain(winner);
    const loser = winner === BEN ? "U_MIA" : "U_BEN";
    const name = winner === BEN ? "Ben Okoro" : "Mia Fourie";
    expect(told).toEqual([{ url: `https://hooks.slack.test/${loser}`, text: `Already approved by ${name}. The first decision counts.` }]);
    expect(dms).toEqual(["U_SIPHO"]); // one DM, not two
  });

  it("tells a later click who decided, and changes nothing", async () => {
    const r = pending();
    Object.assign(row(r.id), { status: "declined", decided_by: MIA, decided_at: "2026-11-26T06:00:00Z", decision_note: "No" });
    await handleLeaveInteraction(serviceClient(db), click("U_BEN", "pm_leave_approve", String(r.id)), deps);
    await runAfter();
    expect(row(r.id)).toMatchObject({ status: "declined", decided_by: MIA });
    expect(told[0].text).toBe("Already denied by Mia Fourie. The first decision counts.");
  });

  it("refuses the requester, staff and unlinked Slack users", async () => {
    const r = pending();
    for (const [slackUser, words] of [
      ["U_SIPHO", "Nobody decides their own leave."],
      ["U_ZOE", "Only another leader of this department, or an admin, can decide this."],
      ["U_GINA", "Only another leader of this department, or an admin, can decide this."], // another department's leader
      ["U_NOBODY", "Your Slack isn't linked to a Hub account yet. Link it on your Hub profile."],
    ]) {
      await handleLeaveInteraction(serviceClient(db), click(slackUser, "pm_leave_approve", String(r.id)), deps);
      await runAfter();
      expect(told.pop()?.text).toBe(words);
    }
    expect(row(r.id).status).toBe("pending");
    expect(dms).toEqual([]);
  });

  it("lets an admin decide a sole leader's leave", async () => {
    const r = seedRequest(db, { requester_id: GINA, department_id: GROUNDS_ID, leave_type_id: T_GROUNDS_SICK, start_date: "2026-12-14", end_date: "2026-12-14" });
    await handleLeaveInteraction(serviceClient(db), click("U_ADA", "pm_leave_approve", String(r.id)), deps);
    await runAfter();
    expect(row(r.id)).toMatchObject({ status: "approved", decided_by: ADA });
  });
});

describe("Deny and Approve with a note", () => {
  it("opens the note modal before the ACK", async () => {
    const r = pending();
    await handleLeaveInteraction(serviceClient(db), click("U_BEN", "pm_leave_deny", String(r.id)), deps);
    expect(h.views).toHaveLength(1);
    expect(h.views[0].view.callback_id).toBe("pm_leave_note_view");
    expect(JSON.parse(h.views[0].view.private_metadata)).toEqual({ id: r.id, decision: "declined" });
    expect(row(r.id).status).toBe("pending");
  });

  it("does not open the modal once decided; says who decided", async () => {
    const r = pending();
    Object.assign(row(r.id), { status: "approved", decided_by: MIA, decided_at: "x" });
    await handleLeaveInteraction(serviceClient(db), click("U_BEN", "pm_leave_deny", String(r.id)), deps);
    await runAfter();
    expect(h.views).toHaveLength(0);
    expect(told[0].text).toBe("Already approved by Mia Fourie. The first decision counts.");
  });

  it("needs a note to deny", async () => {
    const r = pending();
    const res = await handleLeaveInteraction(serviceClient(db), submit("U_BEN", String(r.id), "declined", "  "), deps);
    expect(await res.json()).toEqual({ response_action: "errors", errors: { note: "Say why when denying" } });
    expect(row(r.id).status).toBe("pending");
  });

  it("denies with the note and DMs it", async () => {
    const r = pending();
    const res = await handleLeaveInteraction(serviceClient(db), submit("U_MIA", String(r.id), "declined", "Outreach week"), deps);
    expect(res.status).toBe(200);
    expect(row(r.id)).toMatchObject({ status: "declined", decided_by: MIA, decision_note: "Outreach week" });
    await runAfter();
    expect(dms).toEqual(["U_SIPHO"]);
  });

  it("approves with an optional note", async () => {
    const r = pending();
    await handleLeaveInteraction(serviceClient(db), submit("U_BEN", String(r.id), "approved", null), deps);
    expect(row(r.id)).toMatchObject({ status: "approved", decision_note: null });
  });

  it("shows 'already decided' in the modal when someone was quicker", async () => {
    const r = pending();
    Object.assign(row(r.id), { status: "approved", decided_by: BEN, decided_at: "x" });
    const res = await handleLeaveInteraction(serviceClient(db), submit("U_MIA", String(r.id), "declined", "No"), deps);
    const body = await res.json();
    expect(body.response_action).toBe("update");
    expect(JSON.stringify(body.view)).toContain("Already approved by Ben Okoro");
    expect(row(r.id).status).toBe("approved");
  });

  it("refuses a modal from someone who may not decide", async () => {
    const r = pending();
    const res = await handleLeaveInteraction(serviceClient(db), submit("U_ZOE", String(r.id), "approved", null), deps);
    expect((await res.json()).response_action).toBe("errors");
    expect(row(r.id).status).toBe("pending");
    void ZOE;
  });

  it("refuses a tampered modal", async () => {
    const res = await handleLeaveInteraction(
      serviceClient(db),
      { type: "view_submission", user: { id: "U_BEN" }, view: { callback_id: "pm_leave_note_view", private_metadata: "not json", state: { values: {} } } },
      deps
    );
    expect((await res.json()).response_action).toBe("errors");
  });
});
