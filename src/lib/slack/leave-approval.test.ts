import { describe, expect, it, vi } from "vitest";
import {
  ADA,
  BEN,
  GINA,
  GROUNDS_ID,
  GUS,
  MIA,
  NOSLACK,
  PROD_ENV,
  PW_ID,
  SIPHO,
  T_ANNUAL,
  T_GROUNDS_SICK,
  T_SICK,
  ZOE,
  makeWorld,
  seedRequest,
  serviceClient,
  tick,
} from "@/lib/people-manager/testing/world";
import type { MemoryDb } from "@/lib/l10/testing/memory-db";
import {
  buildDecisionDm,
  canSendLeaveSlack,
  loadLeaveContext,
  runLeaveApprovalRequests,
  runLeaveCancelled,
  runLeaveDecided,
  slackNotifyClaims,
  type LeaveNotice,
  type LeaveSlackDeps,
} from "./leave-approval";

function fakeDeps(over: Partial<LeaveSlackDeps> = {}) {
  const sent: { to: string; text: string; blocks: unknown[] }[] = [];
  const updated: { channel: string; ts: string; text: string; blocks: unknown[] }[] = [];
  const logs: string[] = [];
  let ts = 0;
  const deps: LeaveSlackDeps = {
    sendSlackDm: vi.fn(async (to: string, m: { text: string; blocks: unknown[] }) => {
      sent.push({ to, ...m });
      ts += 1;
      return { ok: true, channel: `D_${to}`, ts: `17000000${ts}.0001` };
    }),
    updateMessage: vi.fn(async (channel: string, t: string, m: { text: string; blocks: unknown[] }) => {
      updated.push({ channel, ts: t, ...m });
      return { ok: true };
    }),
    slackReady: () => true,
    now: () => new Date(tick()),
    log: (m: string) => logs.push(m),
    ...over,
  };
  return { deps, sent, updated, logs };
}

const notices = (db: MemoryDb, id: string) => db.tables.leave_requests.find((r) => r.id === id)!.slack_notify as LeaveNotice[];
const sickRequest = (db: MemoryDb, extra: Record<string, unknown> = {}) =>
  seedRequest(db, {
    requester_id: SIPHO,
    department_id: PW_ID,
    leave_type_id: T_SICK,
    start_date: "2026-11-26",
    end_date: "2026-12-01",
    notes: "Flu, doctor's note to follow.",
    covering_user_id: ZOE,
    ...extra,
  });

describe("sends only from production", () => {
  it("is off on previews, with preview writes disabled, and locally", () => {
    expect(canSendLeaveSlack(PROD_ENV)).toBe(true);
    expect(canSendLeaveSlack({ VERCEL_ENV: "preview" } as never)).toBe(false);
    expect(canSendLeaveSlack({ VERCEL_ENV: "production", PREVIEW_WRITES_DISABLED: "1" } as never)).toBe(false);
    expect(canSendLeaveSlack({ VERCEL_ENV: "development" } as never)).toBe(false);
    expect(canSendLeaveSlack({} as never)).toBe(false);
  });

  it("claims and sends nothing outside production", async () => {
    const db = makeWorld();
    const r = sickRequest(db);
    const { deps, sent } = fakeDeps();
    for (const env of [{ VERCEL_ENV: "preview" }, {}, { VERCEL_ENV: "production", PREVIEW_WRITES_DISABLED: "true" }]) {
      expect((await runLeaveApprovalRequests(serviceClient(db), String(r.id), { deps, env: env as never })).outcome).toBe("off");
    }
    expect(sent).toHaveLength(0);
    expect(notices(db, String(r.id))).toEqual([]);
  });

  it("is off when the hub bot is not configured", async () => {
    const db = makeWorld();
    const r = sickRequest(db);
    const { deps, sent } = fakeDeps({ slackReady: () => false });
    expect((await runLeaveApprovalRequests(serviceClient(db), String(r.id), { deps, env: PROD_ENV })).outcome).toBe("off");
    expect(sent).toHaveLength(0);
  });
});

describe("leader routing", () => {
  it("DMs every leader of the department for staff leave, with the card's context", async () => {
    const db = makeWorld();
    seedRequest(db, { requester_id: SIPHO, department_id: PW_ID, leave_type_id: T_SICK, start_date: "2026-02-09", end_date: "2026-02-11", status: "approved", decided_by: BEN, decided_at: "x" });
    seedRequest(db, { requester_id: ZOE, department_id: PW_ID, leave_type_id: T_ANNUAL, start_date: "2026-11-30", end_date: "2026-12-04", status: "approved", decided_by: BEN, decided_at: "x" });
    db.tables.leave_blockouts.push({ id: "b1", user_id: MIA, department_id: PW_ID, start_date: "2026-12-01", end_date: "2026-12-01", reason: "private" });
    const r = sickRequest(db);
    const { deps, sent } = fakeDeps();
    const run = await runLeaveApprovalRequests(serviceClient(db), String(r.id), { deps, env: PROD_ENV });
    expect(run.results).toEqual([
      { user_id: BEN, outcome: "sent" },
      { user_id: MIA, outcome: "sent" },
    ]);
    expect(sent.map((s) => s.to)).toEqual(["U_BEN", "U_MIA"]);
    const card = JSON.stringify(sent[0].blocks);
    expect(sent[0].text).toContain("Sipho Ndlovu asked for sick leave: Thu 26 Nov – Tue 1 Dec · 4 weekdays");
    expect(card).toContain("Sick leave: 7 of 5 guideline days used (+2 over)"); // 3 approved in Feb + 4 asked
    expect(card).toContain("*Covering* Zoe Adams");
    expect(card).toContain("Zoe Adams, away Mon 30 Nov – Fri 4 Dec");
    expect(card).toContain("Mia Fourie, unavailable Tue 1 Dec");
    expect(card).not.toContain("private"); // block-out reasons stay out
    expect(card).toContain("3 of 5 away or unavailable on Tue 1 Dec");
    expect(card).toContain("Mia Fourie got it too, and the first decision counts");
    expect(card).toContain('"action_id":"pm_leave_approve"');
    expect(card).toContain('"action_id":"pm_leave_deny"');
    expect(card).toContain('"action_id":"pm_leave_approve_note"');
    expect(notices(db, String(r.id))).toMatchObject([
      { kind: "approval", recipient_id: BEN, leader_id: BEN, state: "sent", ok: true, channel_id: "D_U_BEN" },
      { kind: "approval", recipient_id: MIA, leader_id: MIA, state: "sent", ok: true, channel_id: "D_U_MIA" },
    ]);
  });

  it("sends a leader's own leave to the other leader only", async () => {
    const db = makeWorld();
    const r = seedRequest(db, { requester_id: MIA, department_id: PW_ID, leave_type_id: T_ANNUAL, start_date: "2026-12-14", end_date: "2026-12-18" });
    const { deps, sent } = fakeDeps();
    await runLeaveApprovalRequests(serviceClient(db), String(r.id), { deps, env: PROD_ENV });
    expect(sent.map((s) => s.to)).toEqual(["U_BEN"]);
  });

  it("sends a sole leader's leave to an admin", async () => {
    const db = makeWorld();
    const r = seedRequest(db, { requester_id: GINA, department_id: GROUNDS_ID, leave_type_id: T_GROUNDS_SICK, start_date: "2026-12-14", end_date: "2026-12-14" });
    const { deps, sent } = fakeDeps();
    const run = await runLeaveApprovalRequests(serviceClient(db), String(r.id), { deps, env: PROD_ENV });
    expect(run.results).toEqual([{ user_id: ADA, outcome: "sent" }]);
    expect(JSON.stringify(sent[0].blocks)).toContain("You get this as a Hub admin: Gina Marsh is the only leader of Grounds.");
    expect(JSON.stringify(sent[0].blocks)).toContain("Sick leave: 1 of 10 guideline days used"); // Grounds' override
  });

  it("sends Grounds staff leave to the Grounds leader, not P&W's", async () => {
    const db = makeWorld();
    const r = seedRequest(db, { requester_id: GUS, department_id: GROUNDS_ID, leave_type_id: T_GROUNDS_SICK, start_date: "2026-12-14", end_date: "2026-12-14" });
    const { deps, sent } = fakeDeps();
    await runLeaveApprovalRequests(serviceClient(db), String(r.id), { deps, env: PROD_ENV });
    expect(sent.map((s) => s.to)).toEqual(["U_GINA"]);
  });

  it("skips and logs an approver without a Slack id", async () => {
    const db = makeWorld();
    db.tables.users.find((u) => u.id === MIA)!.slack_user_id = null;
    const r = sickRequest(db);
    const { deps, sent, logs } = fakeDeps();
    const run = await runLeaveApprovalRequests(serviceClient(db), String(r.id), { deps, env: PROD_ENV });
    expect(run.results).toContainEqual({ user_id: MIA, outcome: "no-slack" });
    expect(sent.map((s) => s.to)).toEqual(["U_BEN"]);
    expect(logs.some((l) => l.includes(MIA) && l.includes("no Slack id"))).toBe(true);
  });
});

describe("idempotent DMs", () => {
  it("sends each approver one card however often it runs", async () => {
    const db = makeWorld();
    const r = sickRequest(db);
    const { deps, sent } = fakeDeps();
    const admin = serviceClient(db);
    await runLeaveApprovalRequests(admin, String(r.id), { deps, env: PROD_ENV });
    const again = await runLeaveApprovalRequests(admin, String(r.id), { deps, env: PROD_ENV });
    expect(again.results.map((x) => x.outcome)).toEqual(["already-sent", "already-sent"]);
    expect(sent).toHaveLength(2);
  });

  it("sends each approver one card when runs overlap", async () => {
    const db = makeWorld();
    const r = sickRequest(db);
    const { deps, sent } = fakeDeps();
    await Promise.all([1, 2, 3].map(() => runLeaveApprovalRequests(serviceClient(db), String(r.id), { deps, env: PROD_ENV })));
    expect(sent.map((s) => s.to).sort()).toEqual(["U_BEN", "U_MIA"]);
    expect(notices(db, String(r.id))).toHaveLength(2);
  });

  it("releases a claim when Slack refuses, so the next run retries", async () => {
    const db = makeWorld();
    const r = sickRequest(db);
    const failing = fakeDeps({ sendSlackDm: vi.fn(async () => ({ ok: false, error: "channel_not_found" })) });
    const first = await runLeaveApprovalRequests(serviceClient(db), String(r.id), { deps: failing.deps, env: PROD_ENV });
    expect(first.results.map((x) => x.outcome)).toEqual(["error", "error"]);
    expect(notices(db, String(r.id))).toMatchObject([
      { recipient_id: BEN, state: "failed", ok: false, error: "channel_not_found" },
      { recipient_id: MIA, state: "failed", ok: false, error: "channel_not_found" },
    ]);
    const ok = fakeDeps();
    await runLeaveApprovalRequests(serviceClient(db), String(r.id), { deps: ok.deps, env: PROD_ENV });
    expect(ok.sent.map((s) => s.to)).toEqual(["U_BEN", "U_MIA"]);
    expect(notices(db, String(r.id)).every((n) => n.state === "sent")).toBe(true);
  });

  it("gives up a claim race cleanly: only one of two claimers wins", async () => {
    const db = makeWorld();
    const r = sickRequest(db);
    const a = slackNotifyClaims(serviceClient(db));
    const b = slackNotifyClaims(serviceClient(db));
    const got = await Promise.all([a.claim(String(r.id), "decision", SIPHO), b.claim(String(r.id), "decision", SIPHO)]);
    expect(got.sort()).toEqual(["claimed", "taken"]);
  });

  it("does not DM approvers once the request is no longer pending", async () => {
    const db = makeWorld();
    const r = sickRequest(db, { status: "cancelled", cancelled_by: SIPHO, cancelled_at: "x" });
    const { deps, sent } = fakeDeps();
    expect((await runLeaveApprovalRequests(serviceClient(db), String(r.id), { deps, env: PROD_ENV })).outcome).toBe("not-pending");
    expect(sent).toHaveLength(0);
  });
});

describe("after the decision", () => {
  async function decided(status: "approved" | "declined", note: string | null) {
    const db = makeWorld();
    const r = sickRequest(db);
    const admin = serviceClient(db);
    const { deps, sent, updated } = fakeDeps();
    await runLeaveApprovalRequests(admin, String(r.id), { deps, env: PROD_ENV });
    Object.assign(db.tables.leave_requests.find((x) => x.id === r.id)!, { status, decided_by: BEN, decided_at: "2026-11-26T06:21:00.000Z", decision_note: note });
    sent.length = 0;
    const run = await runLeaveDecided(admin, String(r.id), { deps, env: PROD_ENV });
    return { db, r, admin, deps, sent, updated, run };
  }

  it("confirms approved leave to the requester once, with the note and the cover reminder", async () => {
    const { db, r, admin, deps, sent, run } = await decided("approved", "Rest up, Sipho.");
    expect(run.results).toEqual([{ user_id: SIPHO, outcome: "sent" }]);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("U_SIPHO");
    const dm = JSON.stringify(sent[0].blocks);
    expect(sent[0].text).toBe("Your sick leave is confirmed: Thu 26 Nov – Tue 1 Dec · 4 weekdays, approved by Ben Okoro.");
    expect(dm).toContain("*Note from Ben* Rest up, Sipho.");
    expect(dm).toContain("get your job completely covered");
    expect(dm).toContain("Zoe Adams is down as covering");
    expect(dm).toContain("Sick leave in 2026: 4 of 5 guideline days used.");
    await runLeaveDecided(admin, String(r.id), { deps, env: PROD_ENV });
    expect(sent).toHaveLength(1);
    expect(notices(db, String(r.id)).filter((n) => n.kind === "decision")).toHaveLength(1);
  });

  it("tells the requester a denial with the note, and asks for other dates", async () => {
    const { sent } = await decided("declined", "Outreach week, we need everyone on sets.");
    const dm = JSON.stringify(sent[0].blocks);
    expect(sent[0].text).toContain("Your sick leave wasn't approved");
    expect(dm).toContain("Outreach week, we need everyone on sets.");
    expect(dm).toContain("Request other dates");
    expect(dm).not.toContain("covered");
  });

  it("rewrites every leader's card to show who decided, without buttons", async () => {
    const { updated, run } = await decided("approved", null);
    expect(run.cards_updated).toBe(2);
    expect(updated.map((u) => u.channel).sort()).toEqual(["D_U_BEN", "D_U_MIA"]);
    const ben = updated.find((u) => u.channel === "D_U_BEN")!;
    const mia = updated.find((u) => u.channel === "D_U_MIA")!;
    expect(ben.text).toMatch(/^✓ Approved by you · 08:21/);
    expect(mia.text).toMatch(/^✓ Approved by Ben Okoro · 08:21/);
    expect(JSON.stringify(mia.blocks)).not.toContain("pm_leave_approve");
    expect(JSON.stringify(mia.blocks)).not.toContain("pm_leave_deny");
  });

  it("skips the requester's DM when they have no Slack id", async () => {
    const db = makeWorld();
    const r = seedRequest(db, { requester_id: NOSLACK, department_id: PW_ID, leave_type_id: T_ANNUAL, start_date: "2026-12-14", end_date: "2026-12-14", status: "approved", decided_by: BEN, decided_at: "x" });
    const { deps, sent, logs } = fakeDeps();
    const run = await runLeaveDecided(serviceClient(db), String(r.id), { deps, env: PROD_ENV });
    expect(run.results).toEqual([{ user_id: NOSLACK, outcome: "no-slack" }]);
    expect(sent).toHaveLength(0);
    expect(logs.join("\n")).toContain("no Slack id");
  });

  it("does nothing for a request that is still pending", async () => {
    const db = makeWorld();
    const r = sickRequest(db);
    const { deps, sent } = fakeDeps();
    expect((await runLeaveDecided(serviceClient(db), String(r.id), { deps, env: PROD_ENV })).outcome).toBe("not-decided");
    expect(sent).toHaveLength(0);
  });

  it("settles the cards on cancel", async () => {
    const db = makeWorld();
    const r = sickRequest(db);
    const admin = serviceClient(db);
    const { deps, updated } = fakeDeps();
    await runLeaveApprovalRequests(admin, String(r.id), { deps, env: PROD_ENV });
    Object.assign(db.tables.leave_requests.find((x) => x.id === r.id)!, { status: "cancelled", cancelled_by: SIPHO, cancelled_at: "2026-11-26T07:00:00.000Z" });
    expect((await runLeaveCancelled(admin, String(r.id), { deps, env: PROD_ENV })).cards_updated).toBe(2);
    expect(updated[0].text).toMatch(/^Cancelled by Sipho/);
  });

  it("names the approval with no cover set", async () => {
    const db = makeWorld();
    const r = seedRequest(db, { requester_id: SIPHO, department_id: PW_ID, leave_type_id: T_ANNUAL, start_date: "2026-12-14", end_date: "2026-12-14", status: "approved", decided_by: MIA, decided_at: "x" });
    const c = (await loadLeaveContext(serviceClient(db), String(r.id), PROD_ENV))!;
    expect(JSON.stringify(buildDecisionDm(c).blocks)).toContain("Nobody is down as covering yet");
  });
});
