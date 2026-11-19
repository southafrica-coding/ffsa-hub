// The 07:00 reminder: never sends outside the live site, sends nothing on empty days,
// never twice a day, and says what the tested rules say (SPEC 6.11, 10.14).
// Email and Slack are mocked: no test can message anyone.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedFleetData } from "./testing/seed";
import type { FleetData } from "./rules";

vi.mock("@/lib/email/send-transactional", () => ({ sendTransactional: vi.fn(async () => { throw new Error("real email must not be sent in tests"); }) }));
vi.mock("@/lib/slack/client", () => ({
  openConversation: vi.fn(async () => { throw new Error("real Slack must not be called in tests"); }),
  postMessage: vi.fn(async () => { throw new Error("real Slack must not be called in tests"); }),
}));

let data: FleetData;
let coordinators = [{ userId: "u1", name: "Thabo Mokoena", phone: "082", email: "thabo@example.org", slackUserId: "U123" }];
vi.mock("./load", () => ({
  loadFleet: async () => ({ F: data, vehicleRows: [], providers: [], coordinator: coordinators[0] ?? null, coordinators }),
}));

import { canSendFleetReminder, deliverReminder, fleetDigestPart, reminderDigestParts, reminderSlackText, runFleetReminder, type ReminderDeps } from "./reminder-send";
import { buildReminder } from "./rules";

function fakeDeps() {
  const sent: { channel: string; to: string; subject?: string; text: string }[] = [];
  const deps: ReminderDeps = {
    sendEmail: async (to, subject, _html, text) => (sent.push({ channel: "email", to, subject, text }), { ok: true }),
    sendSlackDm: async (to, text) => (sent.push({ channel: "slack", to, text }), { ok: true }),
    slackReady: () => true,
  };
  return { sent, deps };
}

function fakeAdmin() {
  const log: Record<string, unknown>[] = [];
  const admin = {
    log,
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        expect(table).toBe("fleet_reminder_sends");
        if (log.some((r) => r.date === row.date)) return { error: { code: "23505", message: "duplicate key" } };
        log.push({ ...row });
        return { error: null };
      },
      update: (patch: Record<string, unknown>) => ({
        eq: async (_c: string, date: string) => {
          Object.assign(log.find((r) => r.date === date) || {}, patch);
          return { error: null };
        },
      }),
    }),
  };
  return admin;
}

beforeEach(() => {
  data = seedFleetData("2026-11-17");
  coordinators = [{ userId: "u1", name: "Thabo Mokoena", phone: "082", email: "thabo@example.org", slackUserId: "U123" }];
});

describe("send guard", () => {
  it("is off until switched on, and then sends only on the live site", () => {
    const e = (x: Record<string, string>) => x as unknown as NodeJS.ProcessEnv;
    expect(canSendFleetReminder(e({ VERCEL_ENV: "production" }))).toBe(false); // not switched on
    expect(canSendFleetReminder(e({ VERCEL_ENV: "production", FLEET_MESSAGES_ENABLED: "" }))).toBe(false);
    expect(canSendFleetReminder(e({ FLEET_MESSAGES_ENABLED: "1" }))).toBe(false); // local
    expect(canSendFleetReminder(e({ VERCEL_ENV: "development", FLEET_MESSAGES_ENABLED: "1" }))).toBe(false);
    expect(canSendFleetReminder(e({ VERCEL_ENV: "preview", FLEET_MESSAGES_ENABLED: "1" }))).toBe(false);
    expect(canSendFleetReminder(e({ VERCEL_ENV: "production", FLEET_MESSAGES_ENABLED: "1", PREVIEW_WRITES_DISABLED: "1" }))).toBe(false);
    expect(canSendFleetReminder(e({ VERCEL_ENV: "production", FLEET_MESSAGES_ENABLED: "1" }))).toBe(true);
  });
});

describe("runFleetReminder", () => {
  it("builds the 17 Nov reminder as the scheduled task did, and sends nothing when send is off", async () => {
    const admin = fakeAdmin();
    const { sent, deps } = fakeDeps();
    const run = await runFleetReminder(admin, { date: "2026-11-17", send: false, deps, url: "https://hub.example/bookings/vehicles/fleet" });
    expect(run.outcome).toBe("preview");
    expect(run.reminder.subject).toBe("FFSA inspections – Tuesday, 17 Nov: 2 due today");
    expect(run.reminder.text.endsWith("Open Fleet: https://hub.example/bookings/vehicles/fleet")).toBe(true);
    expect(sent).toHaveLength(0);
    expect(admin.log).toHaveLength(0);
  });

  it("emails once and logs it, with no Slack DM of its own (Slack is the digest); a second run the same day sends nothing", async () => {
    const admin = fakeAdmin();
    const { sent, deps } = fakeDeps();
    const run = await runFleetReminder(admin, { date: "2026-11-17", send: true, deps, url: "https://hub.example/x" });
    expect(run.outcome).toBe("sent");
    expect(sent.map((s) => [s.channel, s.to])).toEqual([["email", "thabo@example.org"]]);
    expect(sent[0].subject).toBe("FFSA inspections – Tuesday, 17 Nov: 2 due today");
    expect(admin.log[0]).toMatchObject({ date: "2026-11-17", recipients: [{ name: "Thabo Mokoena", email: "ok", slack: "off" }] });

    const again = await runFleetReminder(admin, { date: "2026-11-17", send: true, deps, url: "https://hub.example/x" });
    expect(again.outcome).toBe("already-sent");
    expect(sent).toHaveLength(1);
  });

  it("sends nothing when every section is empty", async () => {
    data = { ...data, vehicles: [], trips: [], visits: [] };
    const admin = fakeAdmin();
    const { sent, deps } = fakeDeps();
    const run = await runFleetReminder(admin, { date: "2026-11-17", send: true, deps });
    expect(run.outcome).toBe("empty");
    expect(sent).toHaveLength(0);
    expect(admin.log).toHaveLength(0);
  });

  it("sends nothing (and logs nothing) when no one holds the role", async () => {
    coordinators = [];
    const admin = fakeAdmin();
    const { sent, deps } = fakeDeps();
    const run = await runFleetReminder(admin, { date: "2026-11-17", send: true, deps });
    expect(run.outcome).toBe("no-coordinator");
    expect(sent).toHaveLength(0);
    expect(admin.log).toHaveLength(0);
  });
});

describe("deliverReminder", () => {
  const r = buildReminder(seedFleetData("2026-11-17"), "2026-11-17", { appUrl: "X", linkText: "Open Fleet" });

  it("follows the email / Slack switches and reports missing addresses and errors", async () => {
    const { sent, deps } = fakeDeps();
    const res = await deliverReminder(r, "X", [{ userId: "a", name: "A", phone: "", email: "", slackUserId: "U1" }], { email: true, slack: false }, deps);
    expect(res).toEqual([{ name: "A", email: "missing", slack: "off" }]);
    expect(sent).toHaveLength(0);

    const failing: ReminderDeps = { ...deps, sendSlackDm: async () => ({ ok: false, error: "channel_not_found" }) };
    const res2 = await deliverReminder(r, "X", [{ userId: "b", name: "B", phone: "", email: "b@x.org", slackUserId: "U2" }], {}, failing);
    expect(res2[0]).toMatchObject({ email: "ok", slack: "error", errors: ["slack: channel_not_found"] });
  });

  it("puts every section into the Slack message, with the link", () => {
    const text = reminderSlackText(r, "https://hub.example/bookings/vehicles/fleet");
    expect(text.startsWith("*FFSA inspections – Tuesday, 17 Nov: 2 due today*")).toBe(true);
    expect(text).toContain("*Today*\n• Hyundai H1 #1 (KVS 119 NW) – weekly check\n• Hyundai H1 #2 (JYD 637 NW) – weekly check");
    expect(text.endsWith("<https://hub.example/bookings/vehicles/fleet|Open Fleet>")).toBe(true);
  });
});

describe("fleetDigestPart: one Slack message, not two (Jack, 18 Nov 2026)", () => {
  const live = { VERCEL_ENV: "production", FLEET_MESSAGES_ENABLED: "1" } as unknown as NodeJS.ProcessEnv;

  it("on the live site: emails, and hands the digest the sections and the coordinator's Slack id", async () => {
    const admin = fakeAdmin();
    const { sent, deps } = fakeDeps();
    const part = await fleetDigestPart(admin, { date: "2026-11-17", deps, env: live });
    expect(part.outcome).toBe("sent");
    expect(sent.map((s) => s.channel)).toEqual(["email"]);
    expect(part.slackUserIds).toEqual(["U123"]);
    expect(part.parts[0]).toMatch(/^\*🔧 Inspections – <.+\/bookings\/vehicles\/fleet\|open Fleet>\*$/);
    expect(part.parts[1]).toBe("*Today*\n• Hyundai H1 #1 (KVS 119 NW) – weekly check\n• Hyundai H1 #2 (JYD 637 NW) – weekly check");
    expect(part.items).toBeGreaterThanOrEqual(2);
  });

  it("switched off or anywhere else: sends nothing and adds nothing to the digest", async () => {
    for (const env of [{}, { VERCEL_ENV: "production" }, { VERCEL_ENV: "preview", FLEET_MESSAGES_ENABLED: "1" }] as unknown as NodeJS.ProcessEnv[]) {
      const admin = fakeAdmin();
      const { sent, deps } = fakeDeps();
      const part = await fleetDigestPart(admin, { date: "2026-11-17", deps, env });
      expect(part).toMatchObject({ outcome: "preview", parts: [], items: 0, slackUserIds: [] });
      expect(sent).toHaveLength(0);
    }
  });

  it("adds nothing when Slack is switched off on the Schedule page", async () => {
    data = { ...data, notify: { ...(data.notify || {}), slack: false } } as FleetData;
    const { deps } = fakeDeps();
    const part = await fleetDigestPart(fakeAdmin(), { date: "2026-11-17", deps, env: live });
    expect(part.parts).toEqual([]);
  });

  it("adds nothing on an empty day", () => {
    expect(reminderDigestParts({ subject: "", text: "", sections: {} as never, empty: true }, "X")).toEqual([]);
  });
});
