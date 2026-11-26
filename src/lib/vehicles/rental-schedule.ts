// Who gets which standard booking message, and sending them (Gideon, 24 Nov 2026).
//
//   06:30 SAST, phase "pickup": bookings collected today → the person who booked
//                               (pickup-point) and every driver (pickup-driver).
//   07:00 SAST, phase "return": due back tomorrow → return-before (not on the pick-up
//                               day itself: the pick-up message already says when);
//                               due back today, not yet returned → return-day, and the
//                               Vehicle Coordinator's "due back today" Slack message
//                               with the Returned button.
//
// Drivers on the Hub get Slack and email; drivers who aren't get email (if the booking
// has one for them). The person who booked gets Slack and email. Someone who is both
// the person who booked and a driver gets one message, the point person's (it includes
// the driver instructions). Each message is claimed in vehicle_rental_sends before it
// goes, so a re-run never sends twice. Only approved bookings get messages.
//
// planRentalSends is pure (the simulation and the tests drive it); runRentalMessages
// loads, claims, sends and logs with the admin client.

import * as slack from "@/lib/slack/client";
import { sendTransactional } from "@/lib/email/send-transactional";
import {
  rentalMessage,
  toEmailHtml,
  toSlackText,
  type RentalContext,
  type RentalMessageKind,
  type RentalVehicle,
} from "./rental-messages";
import { lastDayFrom } from "./return-day";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type RentalPhase = "pickup" | "return";

export interface RentalBooking {
  id: string;
  booking_name: string;
  status: string;
  checkout_date: string;
  return_date: string;
  returned_at?: string | null;
  requested_by: string | null;
  requester_name: string | null;
  requester_email: string | null;
  vehicles: RentalVehicle[];
  drivers: { name: string; email: string | null; user_id: string | null }[];
}
export interface RentalUser {
  id: string;
  name: string;
  firstName: string;
  email: string | null;
  slackUserId: string | null;
}
export interface RentalRecipient {
  /** The vehicle_rental_sends key: user id, or lower-cased email. */
  key: string;
  name: string;
  firstName: string;
  email: string | null;
  userId: string | null;
  slackUserId: string | null;
  role: "point" | "driver";
}
export interface RentalSend {
  bookingId: string;
  kind: RentalMessageKind;
  forDate: string;
  to: RentalRecipient;
  ctx: RentalContext;
}
export interface RentalPlan {
  sends: RentalSend[];
  /** Bookings due back today, for the coordinator's Returned message. */
  dueBack: RentalBooking[];
}

const SITE = (process.env.NEXT_PUBLIC_APP_URL || "https://www.ffsahub.com").replace(/\/$/, "");
export const bookingLink = (id: string) => `${SITE}/bookings/vehicles/${id}`;

export const firstName = (name: string | null | undefined) => (name || "").trim().split(/\s+/)[0] || "there";

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The people one booking's messages go to: the person who booked, then each driver. */
export function rentalRecipients(b: RentalBooking, users: Map<string, RentalUser>): RentalRecipient[] {
  const out: RentalRecipient[] = [];
  const seen = new Set<string>();
  const add = (r: RentalRecipient) => {
    const keys = [r.userId, r.email?.toLowerCase()].filter(Boolean) as string[];
    if (!keys.length || keys.some((k) => seen.has(k))) return;
    keys.forEach((k) => seen.add(k));
    out.push(r);
  };

  const req = b.requested_by ? users.get(b.requested_by) : undefined;
  const pointEmail = (req?.email || b.requester_email || "").trim().toLowerCase() || null;
  const pointName = b.requester_name || req?.name || "";
  add({
    key: req?.id || pointEmail || "",
    name: pointName,
    firstName: firstName(pointName || req?.firstName),
    email: pointEmail,
    userId: req?.id ?? null,
    slackUserId: req?.slackUserId ?? null,
    role: "point",
  });

  for (const d of b.drivers) {
    const u = d.user_id ? users.get(d.user_id) : undefined;
    const email = (u?.email || d.email || "").trim().toLowerCase() || null;
    add({
      key: u?.id || email || "",
      name: d.name,
      firstName: firstName(d.name),
      email,
      userId: u?.id ?? null,
      slackUserId: u?.slackUserId ?? null,
      role: "driver",
    });
  }
  return out.filter((r) => r.key);
}

/** Can we reach this driver at all? (For the point person's "forward it to …" line.) */
const reachable = (b: RentalBooking, users: Map<string, RentalUser>) =>
  b.drivers.map((d) => {
    const u = d.user_id ? users.get(d.user_id) : undefined;
    return { name: d.name, reached: !!(u?.email || u?.slackUserId || d.email) };
  });

export function planRentalSends(opts: {
  today: string;
  phase: RentalPhase;
  bookings: RentalBooking[];
  users: Map<string, RentalUser>;
  coordinator: { name: string; phone: string };
}): RentalPlan {
  const { today, phase, users } = opts;
  const tomorrow = addDays(today, 1);
  const sends: RentalSend[] = [];
  const dueBack: RentalBooking[] = [];

  for (const b of opts.bookings) {
    if (b.status !== "approved") continue;
    const kinds: { kind: RentalMessageKind; forDate: string; who: "point" | "driver" | "all" }[] = [];
    if (phase === "pickup" && b.checkout_date === today) {
      kinds.push({ kind: "pickup-point", forDate: today, who: "point" }, { kind: "pickup-driver", forDate: today, who: "driver" });
    }
    if (phase === "return") {
      if (b.return_date === tomorrow && b.checkout_date !== today && !b.returned_at) kinds.push({ kind: "return-before", forDate: b.return_date, who: "all" });
      if (b.return_date === today && !b.returned_at) {
        kinds.push({ kind: "return-day", forDate: today, who: "all" });
        dueBack.push(b);
      }
    }
    if (!kinds.length) continue;

    const recipients = rentalRecipients(b, users);
    const base = {
      bookingName: b.booking_name,
      vehicles: b.vehicles,
      collect: b.checkout_date,
      lastDay: lastDayFrom(b.return_date),
      dueBack: b.return_date,
      bookingUrl: bookingLink(b.id),
      coordinator: opts.coordinator,
    };
    for (const k of kinds) {
      for (const r of recipients) {
        if (k.who !== "all" && k.who !== r.role) continue;
        const ctx: RentalContext = {
          ...base,
          firstName: r.firstName,
          drivers: r.role === "point" ? reachable(b, users) : undefined,
          canReturnEarly: !!r.userId,
        };
        sends.push({ bookingId: b.id, kind: k.kind, forDate: k.forDate, to: r, ctx });
      }
    }
  }
  return { sends, dueBack };
}

// ── Loading ────────────────────────────────────────────────

export async function loadRentalBookings(admin: Client, today: string): Promise<RentalBooking[]> {
  const tomorrow = addDays(today, 1);
  const { data, error } = await admin
    .from("vehicle_bookings")
    .select(
      "id, booking_name, status, checkout_date, return_date, returned_at, requested_by, requester_name, requester_email, " +
        "vehicle_booking_assignments(vehicles(name, registration_plate, fuel_type)), vehicle_booking_drivers(name, email, user_id)"
    )
    .eq("status", "approved")
    .or(`checkout_date.eq.${today},return_date.eq.${today},return_date.eq.${tomorrow}`);
  if (error) throw new Error(error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((b) => ({
    id: b.id,
    booking_name: b.booking_name,
    status: b.status,
    checkout_date: b.checkout_date,
    return_date: b.return_date,
    returned_at: b.returned_at ?? null,
    requested_by: b.requested_by,
    requester_name: b.requester_name,
    requester_email: b.requester_email,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vehicles: (b.vehicle_booking_assignments ?? []).map((a: any) => a.vehicles).filter(Boolean).map((v: any) => ({ name: v.name, reg: v.registration_plate, fuel: v.fuel_type })),
    drivers: b.vehicle_booking_drivers ?? [],
  }));
}

export async function loadRentalUsers(admin: Client, ids: string[]): Promise<Map<string, RentalUser>> {
  const map = new Map<string, RentalUser>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return map;
  const { data } = await admin.from("users").select("id, first_name, preferred_name, last_name, email, slack_user_id").in("id", uniq);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const u of (data ?? []) as any[]) {
    const first = (u.preferred_name || u.first_name || "").trim();
    map.set(u.id, { id: u.id, firstName: first, name: [first, (u.last_name || "").trim()].filter(Boolean).join(" "), email: u.email, slackUserId: u.slack_user_id });
  }
  return map;
}

/** The Vehicle Coordinator's name and number for the messages: the first person who
 *  gets the vehicle Slack alerts (vehicle_alert_settings), from their Hub profile. */
export async function rentalCoordinator(admin: Client): Promise<{ name: string; phone: string; userId: string | null }> {
  const { data: settings } = await admin.from("vehicle_alert_settings").select("slack_alert_user_ids").maybeSingle();
  const id = ((settings?.slack_alert_user_ids as string[] | null) ?? []).filter(Boolean)[0];
  if (id) {
    const { data: u } = await admin.from("users").select("first_name, preferred_name, last_name, phone").eq("id", id).maybeSingle();
    if (u) {
      const first = (u.preferred_name || u.first_name || "").trim();
      const name = [first, (u.last_name || "").trim()].filter(Boolean).join(" ");
      if (u.phone) return { name: name || "the Vehicle Coordinator", phone: u.phone, userId: id };
    }
  }
  return { name: "the Vehicle Coordinator", phone: "on your booking page", userId: id ?? null };
}

// ── Sending ────────────────────────────────────────────────

async function slackIdFor(admin: Client, r: RentalRecipient): Promise<string | null> {
  if (r.slackUserId) return r.slackUserId;
  if (!r.email) return null;
  const { data } = await admin.from("users").select("slack_user_id").ilike("email", r.email).not("slack_user_id", "is", null).limit(1).maybeSingle();
  if (data?.slack_user_id) return data.slack_user_id as string;
  // A driver who isn't on the Hub gets email only (Gideon, 24 Nov), so no Slack lookup for them.
  if (!r.userId) return null;
  try {
    const res = await slack.lookupUserByEmail(r.email);
    return res.ok && res.user?.id ? res.user.id : null;
  } catch {
    return null;
  }
}

export type RentalSendResult = { bookingId: string; kind: RentalMessageKind; to: string; slack: boolean; email: boolean; skipped?: "already sent" };

/** Send one planned message: claim it, Slack (Hub users), email, log. Never throws. */
export async function sendRental(admin: Client, s: RentalSend): Promise<RentalSendResult> {
  const result: RentalSendResult = { bookingId: s.bookingId, kind: s.kind, to: s.to.name || s.to.key, slack: false, email: false };
  try {
    const { data: claimed } = await admin
      .from("vehicle_rental_sends")
      .upsert(
        { vehicle_booking_id: s.bookingId, kind: s.kind, recipient: s.to.key, for_date: s.forDate },
        { onConflict: "vehicle_booking_id,kind,recipient,for_date", ignoreDuplicates: true }
      )
      .select("id");
    const rowId = (claimed as { id: string }[] | null)?.[0]?.id;
    if (!rowId) return { ...result, skipped: "already sent" };

    const msg = rentalMessage(s.kind, s.ctx);
    if (s.to.userId && process.env.SLACK_BOT_TOKEN) {
      const slackId = await slackIdFor(admin, s.to);
      if (slackId) {
        const open = await slack.openConversation(slackId);
        if (open.ok && open.channel?.id) {
          const text = toSlackText(msg);
          const posted = await slack.postMessage({ channel: open.channel.id, text: msg.subject, blocks: rentalSlackBlocks(msg, text, s.bookingId) });
          result.slack = !!posted.ok;
        }
      }
    }
    if (s.to.email) {
      const sent = await sendTransactional({
        to: s.to.email,
        subject: msg.subject,
        html: toEmailHtml(msg, SITE),
        category: `vehicle_rental_${s.kind}`,
        sourceType: "vehicle_booking",
        sourceId: s.bookingId,
        reason: s.to.role === "point" ? "They booked this vehicle" : "They're a driver on this vehicle booking",
      }).catch(() => null);
      result.email = !!sent?.ok;
    }
    await admin.from("vehicle_rental_sends").update({ via_slack: result.slack, via_email: result.email }).eq("id", rowId);
    await admin.from("vehicle_booking_messages").insert({
      vehicle_booking_id: s.bookingId,
      kind: s.kind,
      body: msg.subject,
      recipient: s.to.name || s.to.email,
      via_slack: result.slack,
      via_email: result.email,
    });
  } catch (err) {
    console.error("[vehicles/rental] send failed", err);
  }
  return result;
}

export const RENTAL_RETURN_EARLY = "vh_return_early";

/** Slack blocks: the text in sections (Slack's 3000-character limit), then the button. */
export function rentalSlackBlocks(msg: ReturnType<typeof rentalMessage>, text: string, bookingId: string) {
  const chunks: string[] = [];
  let cur = "";
  for (const para of text.split("\n\n")) {
    if ((cur + "\n\n" + para).length > 2900 && cur) {
      chunks.push(cur);
      cur = para;
    } else cur = cur ? cur + "\n\n" + para : para;
  }
  if (cur) chunks.push(cur);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = chunks.map((t) => ({ type: "section", text: { type: "mrkdwn", text: t } }));
  if (msg.action) {
    blocks.push({
      type: "actions",
      elements: [
        msg.action.id === "return-early"
          ? { type: "button", text: { type: "plain_text", text: msg.action.label }, action_id: RENTAL_RETURN_EARLY, value: bookingId, style: "primary" }
          : { type: "button", text: { type: "plain_text", text: msg.action.label }, url: msg.action.url, action_id: "vh_open" },
      ],
    });
  }
  return blocks;
}

/** The scheduled run: plan today's messages for this phase and send them. */
export async function runRentalMessages(
  admin: Client,
  opts: { today: string; phase: RentalPhase; notifyDueBack?: (bookingId: string) => Promise<void> }
): Promise<{ sent: RentalSendResult[]; dueBack: string[] }> {
  const bookings = await loadRentalBookings(admin, opts.today);
  const users = await loadRentalUsers(admin, bookings.flatMap((b) => [b.requested_by, ...b.drivers.map((d) => d.user_id)]).filter(Boolean) as string[]);
  const coordinator = await rentalCoordinator(admin);
  const plan = planRentalSends({ today: opts.today, phase: opts.phase, bookings, users, coordinator });
  const sent: RentalSendResult[] = [];
  for (const s of plan.sends) sent.push(await sendRental(admin, s));
  if (opts.notifyDueBack) for (const b of plan.dueBack) await opts.notifyDueBack(b.id).catch((e) => console.error("[vehicles/rental] due-back", e));
  return { sent, dueBack: plan.dueBack.map((b) => b.id) };
}

/** Booking messages from the Hub stay off until an admin turns them on (production only). */
export function rentalMessagesOn(env: Record<string, string | undefined> = process.env): boolean {
  const on = (env.VEHICLE_RENTAL_MESSAGES_ENABLED || "").toLowerCase();
  return (on === "1" || on === "true") && env.VERCEL_ENV === "production";
}
