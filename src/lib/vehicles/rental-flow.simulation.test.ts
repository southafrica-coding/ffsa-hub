// The whole vehicle booking flow, simulated day by day on made-up people and an in-memory
// database (Gideon, 24 Nov 2026: "a full simulation … of the entire process"). The real
// code runs; only Slack, email and the database are stand-ins, so nothing is sent.
//
// Booking A: Nissan Almera + Honda CR-V for a visiting team. Picked up Mon 30 Nov, needed
//   until Thu 3 Dec, so due back Fri 4 Dec before 12:00. Messages on the pick-up day, the
//   day before and the due-back day; the coordinator taps Returned; the post-rental
//   inspections in Fleet complete the booking.
// Booking B: VW Kombi (diesel). Needed until Sun 6 Dec (due back Mon 7 Dec); the driver
//   asks on the Hub to return it early, on Sat 5 Dec; the coordinator approves in Slack,
//   and the reminders follow the new day.
//
// SIM_OUT=/path/file.json writes every message to a file (for the meeting walkthrough).
// The Hub's Training page (Rent a Vehicle → Training) plays this run from training/scenario.json.
// The last test fails if the file no longer matches; SIM_UPDATE=1 rewrites it.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createFakeDb } from "./testing/fake-db";

const db = createFakeDb();
type Event = { kind: "slack" | "slack-update" | "modal" | "email"; to: string; text: string; blocks?: unknown[]; subject?: string; html?: string };
const steps: { at: string; title: string; detail?: string; events: Event[] }[] = [];
let events: Event[] = [];

const ID = {
  coord: "00000000-0000-4000-8000-c00000000001",
  thandi: "00000000-0000-4000-8000-a00000000001",
  jonah: "00000000-0000-4000-8000-a00000000002",
  almera: "00000000-0000-4000-8000-e00000000001",
  crv: "00000000-0000-4000-8000-e00000000002",
  kombi: "00000000-0000-4000-8000-e00000000003",
  A: "00000000-0000-4000-8000-b00000000001",
  B: "00000000-0000-4000-8000-b00000000002",
};
const SLACK: Record<string, string> = { UCOORD: "Vehicle Coordinator (Pieter)", UTHANDI: "Thandi Mokoena", UJONAH: "Jonah Peters" };

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));
vi.mock("@/lib/slack/client", () => ({
  openConversation: async (id: string) => ({ ok: true, channel: { id: `D-${id}` } }),
  postMessage: async (m: { channel: string; text: string; blocks?: unknown[] }) => {
    events.push({ kind: "slack", to: SLACK[m.channel.slice(2)] || m.channel, text: m.text, blocks: m.blocks });
    return { ok: true, ts: String(Date.now() + events.length), channel: m.channel };
  },
  updateMessage: async (m: { channel: string; text: string; blocks?: unknown[] }) => {
    events.push({ kind: "slack-update", to: SLACK[m.channel.slice(2)] || m.channel, text: m.text, blocks: m.blocks });
    return { ok: true };
  },
  openView: async (_t: string, view: { title: { text: string }; blocks: unknown[] }) => {
    events.push({ kind: "modal", to: "(the person who tapped)", text: view.title.text, blocks: view.blocks });
    return { ok: true };
  },
  lookupUserByEmail: async () => ({ ok: false }),
}));
vi.mock("@/lib/email/send-transactional", () => ({
  sendTransactional: async (m: { to: string; subject: string; html: string }) => {
    events.push({ kind: "email", to: m.to, text: m.subject, subject: m.subject, html: m.html });
    return { ok: true };
  },
}));
vi.mock("next/server", async (orig) => {
  const real = await orig<typeof import("next/server")>();
  return { ...real, after: (fn: () => unknown) => pendingAfter.push(Promise.resolve().then(fn)) };
});
vi.mock("@/services/vehicles", async (orig) => ({
  ...(await orig<object>()),
  getVehicleAccess: async (_s: unknown, uid: string) => ({ isAdmin: false, canApprove: uid === ID.coord, canManage: uid === ID.coord }),
}));
const pendingAfter: Promise<unknown>[] = [];
const flush = async () => {
  while (pendingAfter.length) await pendingAfter.shift();
};

import { runRentalMessages } from "./rental-schedule";
import { notifyDueBack, completeIfInspected, requestEarlyReturn, refreshRentalAlerts } from "./rental-return";
import { handleVehicleInteraction } from "./slack-interactions";
import { dueBackFrom } from "./return-day";
import { findVehicleClashes } from "./booking-request";
import { notifyVehicleManagers } from "@/lib/email/send-vehicle-request";
import { notifyVehicleRequester } from "./requester-notify";

async function step(at: string, title: string, fn: () => Promise<unknown>, detail?: string) {
  vi.setSystemTime(new Date(at.replace(" ", "T") + ":00+02:00"));
  events = [];
  await fn();
  await flush();
  steps.push({ at, title, detail, events });
  return events;
}
const cron = (today: string, phase: "pickup" | "return") => runRentalMessages(db, { today, phase, notifyDueBack: (id) => notifyDueBack(id, db) });
const tap = (slackUser: string, action_id: string, value: string, extra: object = {}) =>
  handleVehicleInteraction(db, { type: "block_actions", user: { id: slackUser }, trigger_id: "t", actions: [{ action_id, value }], ...extra });

beforeAll(() => {
  process.env.SLACK_BOT_TOKEN = "xoxb-simulation";
  // As in production with the messages switched on (they're off until Jack sets this).
  process.env.VEHICLE_RENTAL_MESSAGES_ENABLED = "1";
  process.env.VERCEL_ENV = "production";
  vi.useFakeTimers({ toFake: ["Date"] });
  const t = db.tables;
  t.users = [
    { id: ID.coord, first_name: "Pieter", last_name: "Coordinator", email: "coordinator@example.org", slack_user_id: "UCOORD", phone: "+27 00 000 0000" },
    { id: ID.thandi, first_name: "Thandi", last_name: "Mokoena", email: "thandi@example.org", slack_user_id: "UTHANDI", licence_expiry_date: "2030-06-30", licence_file_url: "demo", passport_file_url: "demo", base_driving_test_status: "passed" },
    { id: ID.jonah, first_name: "Jonah", last_name: "Peters", email: "jonah@example.org", slack_user_id: "UJONAH", licence_expiry_date: "2030-06-30", licence_file_url: "demo", passport_file_url: "demo", base_driving_test_status: "passed" },
  ];
  t.vehicle_alert_settings = [{ id: true, slack_alert_user_ids: [ID.coord] }];
  t.vehicles = [
    { id: ID.almera, name: "Nissan Almera", registration_plate: "DEMO 1 GP", fuel_type: "petrol", vehicle_type: "car", status: "active", sort_order: 1 },
    { id: ID.crv, name: "Honda CR-V", registration_plate: "DEMO 2 GP", fuel_type: "petrol", vehicle_type: "car", status: "active", sort_order: 2 },
    { id: ID.kombi, name: "VW Kombi", registration_plate: "DEMO 3 GP", fuel_type: "diesel", vehicle_type: "van", status: "active", sort_order: 3 },
  ];
  t.vehicle_bookings = [
    { id: ID.A, booking_name: "Visiting team: Kruger outreach", status: "pending", purpose: "international_team", num_people: 6, destination: "Kruger National Park", checkout_date: "2026-11-30", return_date: dueBackFrom("2026-12-03"), requested_by: ID.thandi, requester_name: "Thandi Mokoena", requester_email: "thandi@example.org", returned_at: null },
    { id: ID.B, booking_name: "Youth camp transport", status: "approved", purpose: "ministry", num_people: 8, checkout_date: "2026-12-01", return_date: dueBackFrom("2026-12-06"), requested_by: ID.jonah, requester_name: "Jonah Peters", requester_email: "jonah@example.org", returned_at: null },
  ];
  t.vehicle_booking_assignments = [
    { id: "as1", vehicle_booking_id: ID.A, vehicle_id: ID.almera },
    { id: "as2", vehicle_booking_id: ID.A, vehicle_id: ID.crv },
    { id: "as3", vehicle_booking_id: ID.B, vehicle_id: ID.kombi },
  ];
  t.vehicle_booking_drivers = [
    { id: "d1", vehicle_booking_id: ID.A, name: "Thandi Mokoena", user_id: ID.thandi, email: null },
    { id: "d2", vehicle_booking_id: ID.A, name: "Sam Taylor", user_id: null, email: "sam@example.org", license_file_url: "demo", passport_file_url: "demo" },
    { id: "d3", vehicle_booking_id: ID.A, name: "Lee Chen", user_id: null, email: null, license_file_url: "demo", passport_file_url: "demo" },
    { id: "d4", vehicle_booking_id: ID.B, name: "Jonah Peters", user_id: ID.jonah, email: null },
  ];
});

afterAll(() => {
  vi.useRealTimers();
  if (process.env.SIM_OUT) fs.writeFileSync(process.env.SIM_OUT, JSON.stringify({ steps }, null, 2));
});

const to = (e: Event[]) => e.map((x) => `${x.kind} → ${x.to}: ${x.subject || x.text}`);

describe("a vehicle booking, from booking to completed", () => {
  it("booking: the form asks for the last day; the Hub makes it due back the next day", () => {
    expect(db.tables.vehicle_bookings[0].return_date).toBe("2026-12-04");
  });

  it("Sun 29 Nov: Thandi sends the request; the coordinator gets it in Slack and approves", async () => {
    // As POST /api/vehicles/bookings does once the booking and its drivers are saved.
    const e1 = await step(
      "2026-11-29 10:00",
      "Thandi sends the request",
      async () => {
        await notifyVehicleManagers({ event: "requested", bookingId: ID.A, bookingName: "Visiting team: Kruger outreach", requesterName: "Thandi Mokoena", checkoutDate: "2026-11-30", returnDate: "2026-12-04" });
        await notifyVehicleRequester({ bookingId: ID.A, kind: "submitted" });
      },
      "Booking A: Nissan Almera + Honda CR-V, picked up Mon 30 Nov, needed until Thu 3 Dec. The form shows it's due back Fri 4 Dec before 12:00, and the Hub blocks that morning for other bookings."
    );
    expect(e1.some((x) => x.kind === "slack" && x.to === "Vehicle Coordinator (Pieter)" && JSON.stringify(x.blocks).includes("vh_approve"))).toBe(true);
    expect(e1.some((x) => x.to === "Thandi Mokoena" || x.to === "thandi@example.org")).toBe(true);
    const e2 = await step("2026-11-29 14:20", "The coordinator taps Approve", () => tap("UCOORD", "vh_approve", ID.A), "Approve re-checks every driver's licence first.");
    expect(db.tables.vehicle_bookings[0].status).toBe("approved");
    expect(e2.some((x) => x.to === "thandi@example.org")).toBe(true);
  });

  it("pick-up day 06:30: the point person and every driver we can reach", async () => {
    const e = await step("2026-11-30 06:30", "Pick-up day: instructions go out", () => cron("2026-11-30", "pickup"));
    expect(to(e)).toEqual([
      "slack → Thandi Mokoena: Pick-up today: Nissan Almera and Honda CR-V for Visiting team: Kruger outreach",
      "email → thandi@example.org: Pick-up today: Nissan Almera and Honda CR-V for Visiting team: Kruger outreach",
      "email → sam@example.org: Today you collect Nissan Almera and Honda CR-V: checks before you drive",
    ]);
    // Lee has no email: the point person is asked to pass the instructions on.
    expect(e[0].blocks!.map((b: any) => b.text?.text || "").join("\n")).toContain("*Lee Chen* has no email on the booking"); // eslint-disable-line @typescript-eslint/no-explicit-any
    // Running again sends nothing twice.
    const again = await cron("2026-11-30", "pickup");
    expect(again.sent.every((s) => s.skipped === "already sent")).toBe(true);
    steps.pop(); // keep the first run only
    steps.push({ at: "2026-11-30 06:30", title: "Pick-up day: instructions go out", detail: "Thandi booked and drives: one message (Slack + email) with her point-person part and the driver instructions. Sam isn't on the Hub: email. Lee has no email: Thandi's message asks her to pass it on.", events: e });
  });

  it("Tue 1 Dec 06:30: booking B's pick-up", async () => {
    const e = await step("2026-12-01 06:30", "Booking B picked up", () => cron("2026-12-01", "pickup"));
    expect(to(e)).toEqual([
      "slack → Jonah Peters: Pick-up today: VW Kombi for Youth camp transport",
      "email → jonah@example.org: Pick-up today: VW Kombi for Youth camp transport",
    ]);
    expect(e[1].html).toContain("DIESEL");
  });

  it("Thu 3 Dec: Jonah asks on the Hub to return the Kombi early (Sat 5 Dec); the coordinator approves in Slack", async () => {
    const e1 = await step("2026-12-03 09:15", "Return early: Jonah asks on the Hub", () => requestEarlyReturn(db, ID.B, ID.jonah, "2026-12-05", "2026-12-03"), "From the booking page's Return early button. The coordinator gets Approve / I'll call them.");
    expect(to(e1)).toEqual(["slack → Vehicle Coordinator (Pieter): Early return request: Youth camp transport"]);
    const e2 = await step("2026-12-03 09:40", "The coordinator taps Approve", () => tap("UCOORD", "vh_early_approve", ID.B));
    expect(to(e2)).toEqual([
      "slack → Jonah Peters: ✏️ Booking updated — Youth camp transport",
      "email → jonah@example.org: Your vehicle booking was updated",
      "slack-update → Vehicle Coordinator (Pieter): Early return approved: Youth camp transport",
    ].map((s) => s.replace("✏️ Booking updated — Youth camp transport", e2[0].text)));
    expect(db.tables.vehicle_bookings.find((b) => b.id === ID.B)!.return_date).toBe("2026-12-05");
  });

  it("Thu 3 Dec 07:00: the day before booking A is due back, a reminder with Return early", async () => {
    // (Run after the early-return steps above, but it's the 07:00 job of the same day.)
    const e = await step("2026-12-03 07:00", "The day before: reminder", () => cron("2026-12-03", "return"));
    expect(to(e)).toEqual([
      "slack → Thandi Mokoena: Reminder: Nissan Almera and Honda CR-V is due back tomorrow before 12:00",
      "email → thandi@example.org: Reminder: Nissan Almera and Honda CR-V is due back tomorrow before 12:00",
      "email → sam@example.org: Reminder: Nissan Almera and Honda CR-V is due back tomorrow before 12:00",
    ]);
    const slackButtons = JSON.stringify(e[0].blocks);
    expect(slackButtons).toContain("vh_return_early");
    expect(e[2].html).toContain("contact the Vehicle Coordinator"); // Sam isn't on the Hub: the number, not a button
  });

  it("Fri 4 Dec 07:00: due back today: the return instructions, the coordinator's Returned message, and B's reminder", async () => {
    const e = await step("2026-12-04 07:00", "Due-back day: return instructions + coordinator's Returned message", () => cron("2026-12-04", "return"));
    expect(to(e)).toEqual([
      "slack → Thandi Mokoena: Nissan Almera and Honda CR-V is due back today before 12:00",
      "email → thandi@example.org: Nissan Almera and Honda CR-V is due back today before 12:00",
      "email → sam@example.org: Nissan Almera and Honda CR-V is due back today before 12:00",
      "slack → Jonah Peters: Reminder: VW Kombi is due back tomorrow before 12:00",
      "email → jonah@example.org: Reminder: VW Kombi is due back tomorrow before 12:00",
      "slack → Vehicle Coordinator (Pieter): Due back today before 12:00: Visiting team: Kruger outreach",
    ]);
    expect(JSON.stringify(e[5].blocks)).toContain("vh_returned");
    // Booking A is an international team: book a full valet wash, vehicles held until Wed 9 Dec.
    expect(JSON.stringify(e[5].blocks)).toContain("full valet wash");
    expect(JSON.stringify(e[5].blocks)).toContain("Wednesday, 9 December");
  });

  it("10:45: the coordinator taps Returned; the post-rental inspection message follows", async () => {
    const e = await step("2026-12-04 10:45", "The coordinator taps Returned", () => tap("UCOORD", "vh_returned", ID.A));
    expect(to(e)).toEqual([
      "slack-update → Vehicle Coordinator (Pieter): Returned: Visiting team: Kruger outreach",
      "slack → Vehicle Coordinator (Pieter): Post-rental inspection: Visiting team: Kruger outreach",
    ]);
    expect(JSON.stringify(e[1].blocks)).toContain(`/inspect?type=post&booking=${ID.A}`);
    expect(db.tables.vehicle_bookings[0].returned_at).toBeTruthy();
  });

  it("someone on the booking can't tap Returned", async () => {
    events = [];
    await tap("UTHANDI", "vh_returned", ID.B);
    await flush();
    expect(db.tables.vehicle_bookings.find((b) => b.id === ID.B)!.returned_at).toBeNull();
  });

  it("Mark completed before the inspections are recorded: refused, with the links", async () => {
    const r = await completeIfInspected(db, ID.A, ID.coord);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("Record the post-rental inspection first");
  });

  it("11:10 and 11:25: the post-rental inspections are saved in Fleet; the booking completes", async () => {
    const save = (vehicleId: string) => async () => {
      db.tables.fleet_inspections = [...(db.tables.fleet_inspections || []), { id: `ins-${vehicleId.slice(-1)}`, vehicle_id: vehicleId, booking_id: ID.A, type: "post", deleted_at: null }];
      // As POST /api/vehicles/fleet/inspections does after saving a post-rental inspection.
      const r = await completeIfInspected(db, ID.A, ID.coord);
      if (!r.ok) await refreshRentalAlerts(db, ID.A);
      return r;
    };
    const e1 = await step("2026-12-04 11:10", "Post-rental inspection saved: Nissan Almera", save(ID.almera), "Saved in Fleet → Post-rental inspection, linked to the booking.");
    expect(to(e1)).toEqual(["slack-update → Vehicle Coordinator (Pieter): Post-rental inspection: Visiting team: Kruger outreach"]); // 1 of 2
    expect(JSON.stringify(e1[0].blocks)).toContain("✅ Nissan Almera");
    const e2 = await step("2026-12-04 11:25", "Post-rental inspection saved: Honda CR-V → booking completed", save(ID.crv));
    expect(to(e2)).toEqual([
      `slack → Thandi Mokoena: ${e2[0].text}`,
      "email → thandi@example.org: Your vehicle booking is complete",
      "slack-update → Vehicle Coordinator (Pieter): Completed: Visiting team: Kruger outreach",
    ]);
    expect(db.tables.vehicle_bookings[0].status).toBe("completed");
  });

  it("Mon 7 Dec: booking A was an international team, so its cars are held until Wed 9 Dec, even though it's completed", async () => {
    const e = await step(
      "2026-12-07 09:00",
      "Someone tries to book the Almera during the hold",
      async () => {
        const c = await findVehicleClashes(db, "2026-12-07", "2026-12-08", [ID.almera], "ministry");
        expect(c.clashing).toEqual([ID.almera]);
        const later = await findVehicleClashes(db, "2026-12-10", "2026-12-11", [ID.almera], "ministry");
        expect(later.clashing).toEqual([]);
      },
      "Booking A was an International Team booking: after it's due back (Fri 4 Dec), its vehicles are held for 3 working days (Sat 5 to Wed 9 Dec, the weekend included) for the post-rental inspection and a full valet wash. That holds even though the booking is already completed."
    );
    expect(e).toEqual([]);
  });

  it("Sat 5 Dec 07:00: booking B is due back on its new, earlier day", async () => {
    const e = await step("2026-12-05 07:00", "Booking B due back on the earlier day", () => cron("2026-12-05", "return"));
    expect(to(e)).toEqual([
      "slack → Jonah Peters: VW Kombi is due back today before 12:00",
      "email → jonah@example.org: VW Kombi is due back today before 12:00",
      "slack → Vehicle Coordinator (Pieter): Due back today before 12:00: Youth camp transport",
    ]);
  });

  it("the Training page plays exactly this run", () => {
    const site = process.env.NEXT_PUBLIC_APP_URL;
    const run = JSON.parse(site ? JSON.stringify(steps).split(site).join("https://www.ffsahub.com") : JSON.stringify(steps));
    const script = { steps: [...run].sort((a, b) => a.at.localeCompare(b.at)) };
    const file = path.join(__dirname, "training", "scenario.json");
    if (process.env.SIM_UPDATE) fs.writeFileSync(file, JSON.stringify(script, null, 1) + "\n");
    expect(script).toEqual(JSON.parse(fs.readFileSync(file, "utf8")));
  });
});
