// The Vehicle Coordinator's side of a return (Gideon, 24 Nov 2026).
//
//   due-back     — 07:00 on the due-back day: "due back today before 12:00", with a
//                  Returned button. Only the coordinator's tap marks it returned.
//   post-rental  — after Returned: record the post-rental inspection in Fleet (a button
//                  per vehicle). The booking is completed as soon as every vehicle on it
//                  has a post-rental inspection for this booking; Mark completed does the
//                  same, and won't until the inspection is recorded.
//   early-return — someone on the booking asked to bring it back earlier: Approve (the
//                  due-back day moves) or I'll call them.
//
// Each is one tracked Slack message per coordinator (vehicle_booking_slack_alerts),
// rewritten in place as things move on. Best-effort: nothing here may fail the action
// that triggered it.

import * as slack from "@/lib/slack/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { decideVehicleBooking } from "@/services/vehicle-decisions";
import { notifyVehicleRequester } from "@/lib/vehicles/requester-notify";
import { postTracked, section, context, openButton, type Message, type Block } from "@/lib/vehicles/slack-alerts";
import { fmtLong } from "./rental-messages";
import { rentalMessagesOn } from "./rental-schedule";
import { HOLD_PURPOSE, holdDays } from "./hold";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export const VH_RETURNED = "vh_returned";
export const VH_EARLY_APPROVE = "vh_early_approve";
export const VH_EARLY_CALL = "vh_early_call";
export const VH_EARLY_VIEW = "vh_early_view";

const SITE = (process.env.NEXT_PUBLIC_APP_URL || "https://www.ffsahub.com").replace(/\/$/, "");
export const inspectUrl = (vehicleId: string, bookingId: string) =>
  `${SITE}/bookings/vehicles/fleet/${vehicleId}/inspect?type=post&booking=${bookingId}`;

export interface ReturnBooking {
  id: string;
  booking_name: string;
  status: string;
  checkout_date: string;
  return_date: string;
  requested_by: string | null;
  requester_name: string | null;
  returned_at: string | null;
  returned_by: string | null;
  early_return_date: string | null;
  early_return_status: string | null;
  early_return_requested_by: string | null;
  /** 'international_team' keeps the vehicles back after the due-back day (hold.ts). */
  purpose?: string | null;
  hold_released_at?: string | null;
  hold_released_by?: string | null;
  hold_release_note?: string | null;
  vehicles: { id: string; name: string; reg: string | null }[];
  drivers: string[];
}
export interface PostRentalState {
  vehicles: { id: string; name: string; reg: string | null; inspectionId: string | null }[];
  all: boolean;
}

const time = (iso: string) =>
  new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Johannesburg" }).format(new Date(iso));
/** After an International Team: the full valet wash, and how long the vehicles are held. */
export function valetLine(b: ReturnBooking): string | null {
  if (b.purpose !== HOLD_PURPOSE) return null;
  const held = holdDays(b);
  return held
    ? `🧽 *International team: book a full valet wash as soon as it’s back.* The vehicles are held until ${fmtLong(held.to)} for the valet and the post-rental inspection.`
    : `🧽 *International team: book a full valet wash as soon as it’s back.* (The hold after this booking was released.)`;
}

const vehicleList = (b: ReturnBooking) => b.vehicles.map((v) => `*${v.name}*${v.reg ? ` (${v.reg})` : ""}`).join(", ") || "Vehicle";

export async function loadReturnBooking(admin: Client, bookingId: string): Promise<ReturnBooking | null> {
  const { data: b } = await admin
    .from("vehicle_bookings")
    // "*": the hold columns (365) may not exist yet.
    .select("*, vehicle_booking_assignments(vehicle_id, vehicles(id, name, registration_plate)), vehicle_booking_drivers(name)")
    .eq("id", bookingId)
    .maybeSingle();
  if (!b) return null;
  return {
    ...b,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vehicles: ((b.vehicle_booking_assignments ?? []) as any[])
      .map((a) => a.vehicles)
      .filter(Boolean)
      .map((v) => ({ id: v.id, name: v.name, reg: v.registration_plate ?? null })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    drivers: ((b.vehicle_booking_drivers ?? []) as any[]).map((d) => d.name),
  } as ReturnBooking;
}

async function nameOf(admin: Client, userId: string | null): Promise<string> {
  if (!userId) return "someone";
  const { data } = await admin.from("users").select("first_name, preferred_name, last_name").eq("id", userId).maybeSingle();
  const first = (data?.preferred_name || data?.first_name || "").trim();
  return [first, (data?.last_name || "").trim()].filter(Boolean).join(" ") || "someone";
}

/** Which vehicles on the booking have a post-rental inspection recorded for it in Fleet. */
export async function postRentalState(admin: Client, b: ReturnBooking): Promise<PostRentalState> {
  const { data } = await admin.from("fleet_inspections").select("id, vehicle_id, deleted_at").eq("booking_id", b.id).eq("type", "post");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((data ?? []) as any[]).filter((r) => !r.deleted_at);
  const vehicles = b.vehicles.map((v) => ({ ...v, inspectionId: rows.find((r) => r.vehicle_id === v.id)?.id ?? null }));
  return { vehicles, all: vehicles.length > 0 && vehicles.every((v) => v.inspectionId) };
}

// ── Messages ───────────────────────────────────────────────

export function dueBackMessage(b: ReturnBooking, returnedBy?: string): Message {
  const who = [b.requester_name ? `Booked by ${b.requester_name}` : "", b.drivers.length ? `Drivers: ${b.drivers.join(", ")}` : ""].filter(Boolean).join(" · ");
  if (b.returned_at) {
    return {
      text: `Returned: ${b.booking_name}`,
      blocks: [section(`*✅ Returned: ${b.booking_name}*\n${vehicleList(b)}\nMarked returned at ${time(b.returned_at)}${returnedBy ? ` by ${returnedBy}` : ""}. Next: the post-rental inspection${b.purpose === HOLD_PURPOSE ? " and the full valet wash" : ""}.`)],
    };
  }
  if (b.status !== "approved") {
    return { text: `${b.booking_name}: ${b.status}`, blocks: [section(`*${b.booking_name}* is ${b.status}. Nothing to do here.`)] };
  }
  return {
    text: `Due back today before 12:00: ${b.booking_name}`,
    blocks: [
      section(`*🔑 Due back today before 12:00: ${b.booking_name}*\n${vehicleList(b)}\n${who}`),
      ...(valetLine(b) ? [section(valetLine(b)!)] : []),
      context("It should come back washed, with a full tank and the return checks done. Tap *Returned* once you have the keys."),
      {
        type: "actions",
        block_id: `vh:${b.id}`,
        elements: [
          { type: "button", action_id: VH_RETURNED, style: "primary", text: { type: "plain_text", text: "Returned" }, value: b.id },
          openButton(b.id),
        ],
      },
    ],
  };
}

export function postRentalMessage(b: ReturnBooking, st: PostRentalState, completedBy?: string): Message {
  if (b.status === "completed") {
    return {
      text: `Completed: ${b.booking_name}`,
      blocks: [section(`*🏁 Completed: ${b.booking_name}*\n${vehicleList(b)}\nPost-rental inspection recorded${completedBy ? ` by ${completedBy}` : ""}. The booking is completed.`)],
    };
  }
  const lines = st.vehicles.map((v) => `${v.inspectionId ? "✅" : "⬜"} ${v.name}${v.reg ? ` (${v.reg})` : ""}: ${v.inspectionId ? "inspection recorded" : "to do"}`);
  const buttons: Block[] = st.vehicles
    .filter((v) => !v.inspectionId)
    .slice(0, 3)
    .map((v) => ({
      type: "button",
      action_id: `vh_open_inspect_${v.id.slice(0, 8)}`,
      text: { type: "plain_text", text: st.vehicles.length > 1 ? `Inspect ${v.name}`.slice(0, 75) : "Record post-rental inspection" },
      url: inspectUrl(v.id, b.id),
      style: "primary",
    }));
  return {
    text: `Post-rental inspection: ${b.booking_name}`,
    blocks: [
      section(`*🔍 Post-rental inspection: ${b.booking_name}*\n${lines.join("\n")}`),
      ...(valetLine(b) ? [section(valetLine(b)!)] : []),
      context("Record it in Fleet. This booking is marked *Completed* as soon as every vehicle’s post-rental inspection is saved."),
      { type: "actions", block_id: `vh:${b.id}`, elements: [...buttons, { type: "button", action_id: "vh_complete", text: { type: "plain_text", text: "Mark completed" }, value: b.id }] },
    ],
  };
}

export function earlyReturnMessage(b: ReturnBooking, askedBy: string, decidedBy?: string): Message {
  const ask = `${askedBy} asks to return *${b.booking_name}* early: on *${fmtLong(b.early_return_date || b.return_date)}*`;
  if (b.early_return_status === "approved") {
    return { text: `Early return approved: ${b.booking_name}`, blocks: [section(`*✅ Early return approved: ${b.booking_name}*\n${vehicleList(b)}\nNow due back *${fmtLong(b.return_date)}*, before 12:00${decidedBy ? ` (approved by ${decidedBy})` : ""}.`)] };
  }
  if (b.early_return_status === "declined") {
    return { text: `Early return: call ${askedBy}`, blocks: [section(`*📞 Early return: ${b.booking_name}*\n${ask}. ${decidedBy || "You"} will call them. Due back stays *${fmtLong(b.return_date)}*.`)] };
  }
  return {
    text: `Early return request: ${b.booking_name}`,
    blocks: [
      section(`*↩️ Early return request: ${b.booking_name}*\n${vehicleList(b)}\n${ask}, instead of ${fmtLong(b.return_date)}.`),
      {
        type: "actions",
        block_id: `vh:${b.id}`,
        elements: [
          { type: "button", action_id: VH_EARLY_APPROVE, style: "primary", text: { type: "plain_text", text: "Approve" }, value: b.id },
          { type: "button", action_id: VH_EARLY_CALL, text: { type: "plain_text", text: "I’ll call them" }, value: b.id },
          openButton(b.id),
        ],
      },
    ],
  };
}

// ── Updating the coordinator's messages in place ───────────

export async function refreshRentalAlerts(admin: Client, bookingId: string, opts: { by?: string } = {}): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN) return;
  try {
    const { data } = await admin
      .from("vehicle_booking_slack_alerts")
      .select("id, kind, slack_channel, slack_ts")
      .eq("vehicle_booking_id", bookingId)
      .eq("status", "open")
      .in("kind", ["due-back", "post-rental", "early-return"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = ((data ?? []) as any[]).filter((r) => r.slack_channel && r.slack_ts);
    if (!rows.length) return;
    const b = await loadReturnBooking(admin, bookingId);
    if (!b) return;
    const st = await postRentalState(admin, b);
    const asked = await nameOf(admin, b.early_return_requested_by);
    for (const row of rows) {
      let message: Message;
      let close: boolean;
      if (row.kind === "due-back") {
        message = dueBackMessage(b, opts.by);
        close = !!b.returned_at || b.status !== "approved";
      } else if (row.kind === "post-rental") {
        message = postRentalMessage(b, st, opts.by);
        close = b.status !== "approved";
      } else {
        message = earlyReturnMessage(b, asked, opts.by);
        close = b.early_return_status !== "requested";
      }
      await slack.updateMessage({ channel: row.slack_channel, ts: row.slack_ts, ...message }).catch(() => null);
      if (close) await admin.from("vehicle_booking_slack_alerts").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", row.id);
    }
  } catch (err) {
    console.error("[vehicles/rental] refresh failed", err);
  }
}

// ── Actions ────────────────────────────────────────────────

/** 07:00 on the due-back day (from the scheduler). */
export async function notifyDueBack(bookingId: string, admin: Client = createAdminClient()): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN) return;
  const b = await loadReturnBooking(admin, bookingId);
  if (!b || b.returned_at || b.status !== "approved") return;
  await postTracked(admin, bookingId, "due-back", dueBackMessage(b));
}

type Result = { ok: true; message?: string } | { ok: false; error: string };

/** The coordinator tapped Returned: record it, then ask for the post-rental inspection. */
export async function markReturned(admin: Client, bookingId: string, userId: string): Promise<Result> {
  const b = await loadReturnBooking(admin, bookingId);
  if (!b) return { ok: false, error: "That booking no longer exists." };
  if (b.status !== "approved") return { ok: false, error: `This booking is ${b.status}.` };
  if (!b.returned_at) {
    const { error } = await admin.from("vehicle_bookings").update({ returned_at: new Date().toISOString(), returned_by: userId }).eq("id", bookingId).is("returned_at", null);
    if (error) return saveFailed("Couldn’t mark it returned", error);
  }
  const by = await nameOf(admin, userId);
  await refreshRentalAlerts(admin, bookingId, { by });
  // Nothing goes out until VEHICLE_RENTAL_MESSAGES_ENABLED is on (Jack's review of #712).
  if (!rentalMessagesOn()) return { ok: true };
  const fresh = await loadReturnBooking(admin, bookingId);
  if (fresh && process.env.SLACK_BOT_TOKEN) await postTracked(admin, bookingId, "post-rental", postRentalMessage(fresh, await postRentalState(admin, fresh)));
  return { ok: true };
}

/** Complete the booking once every vehicle's post-rental inspection is recorded.
 *  Called when Fleet saves a post-rental inspection, and by Mark completed. */
export async function completeIfInspected(admin: Client, bookingId: string, userId: string): Promise<Result> {
  const b = await loadReturnBooking(admin, bookingId);
  if (!b) return { ok: false, error: "That booking no longer exists." };
  if (b.status === "completed") return { ok: true, message: "Already completed." };
  if (b.status !== "approved") return { ok: false, error: `This booking is ${b.status}.` };
  const st = await postRentalState(admin, b);
  if (!st.all) {
    const missing = st.vehicles.filter((v) => !v.inspectionId);
    return {
      ok: false,
      error: `Record the post-rental inspection first: ${missing.map((v) => `<${inspectUrl(v.id, b.id)}|${v.name}>`).join(", ")}.`,
    };
  }
  if (!b.returned_at) await admin.from("vehicle_bookings").update({ returned_at: new Date().toISOString(), returned_by: userId }).eq("id", bookingId).is("returned_at", null);
  const r = await decideVehicleBooking(admin, userId, bookingId, "completed", null);
  if (!r.ok) return { ok: false, error: r.error };
  await refreshRentalAlerts(admin, bookingId, { by: await nameOf(admin, userId) });
  return { ok: true };
}

/** Someone on the booking asks to bring it back on `date` (before the due-back day). */
export async function requestEarlyReturn(admin: Client, bookingId: string, userId: string, date: string, today: string): Promise<Result> {
  const b = await loadReturnBooking(admin, bookingId);
  if (!b) return { ok: false, error: "That booking no longer exists." };
  if (b.status !== "approved" || b.returned_at) return { ok: false, error: "This booking can’t be changed now." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || date >= b.return_date)
    return { ok: false, error: `Choose a day from today up to the day before ${fmtLong(b.return_date)}.` };
  if (date < b.checkout_date) return { ok: false, error: "That’s before the pick-up day." };
  const { error } = await admin
    .from("vehicle_bookings")
    .update({ early_return_date: date, early_return_status: "requested", early_return_requested_by: userId, early_return_requested_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) return saveFailed("Couldn’t send the early-return request", error);
  // A new request replaces an older one: re-open the coordinator's message.
  await admin.from("vehicle_booking_slack_alerts").delete().eq("vehicle_booking_id", bookingId).eq("kind", "early-return");
  const fresh = rentalMessagesOn() ? await loadReturnBooking(admin, bookingId) : null;
  if (fresh && process.env.SLACK_BOT_TOKEN) await postTracked(admin, bookingId, "early-return", earlyReturnMessage(fresh, await nameOf(admin, userId)));
  return { ok: true, message: `Asked. The Vehicle Coordinator will confirm returning it on ${fmtLong(date)}.` };
}

// The person sees what didn't happen, not the database's message (Jack's review of #723);
// the detail goes to the server log.
function saveFailed(what: string, e: { message?: string }): Result {
  console.error(`[vehicles] ${what}:`, e?.message);
  return { ok: false, error: `${what}. Nothing was changed: try again.` };
}
const decisionFailed = (e: { message?: string }) => saveFailed("Couldn’t save the decision on the early return", e);

/** The coordinator approves (the due-back day moves) or will call them. */
export async function decideEarlyReturn(admin: Client, bookingId: string, userId: string, approve: boolean): Promise<Result> {
  const b = await loadReturnBooking(admin, bookingId);
  if (!b) return { ok: false, error: "That booking no longer exists." };
  if (b.early_return_status !== "requested" || !b.early_return_date) {
    await refreshRentalAlerts(admin, bookingId);
    return { ok: false, error: "There’s no early return waiting on this booking." };
  }
  // Nobody decides their own early return (Jack's review of #712): not the person who
  // booked it, nor the person who asked, either way. The database refuses it too (364, 410).
  if (userId === b.requested_by || userId === b.early_return_requested_by) {
    return { ok: false, error: "You’re on this booking, so another Vehicle Coordinator or an admin has to decide its early return." };
  }
  const by = await nameOf(admin, userId);
  const send = rentalMessagesOn();
  if (approve) {
    const from = b.return_date;
    const { error } = await admin.from("vehicle_bookings").update({ return_date: b.early_return_date, early_return_status: "approved" }).eq("id", bookingId);
    if (error) return decisionFailed(error);
    if (send) await notifyVehicleRequester({ bookingId, kind: "changed", changes: [`Due back: ${fmtLong(from)} → ${fmtLong(b.early_return_date)}, before 12:00 (early return approved)`], sentBy: userId });
  } else {
    const { error } = await admin.from("vehicle_bookings").update({ early_return_status: "declined" }).eq("id", bookingId);
    if (error) return decisionFailed(error);
    if (send) await notifyVehicleRequester({ bookingId, kind: "message", note: `About returning ${b.booking_name} early: ${by} will call you to arrange it. Until then it's still due back ${fmtLong(b.return_date)}, before 12:00.`, sentBy: userId });
  }
  await refreshRentalAlerts(admin, bookingId, { by });
  return { ok: true };
}

/**
 * The Vehicle Coordinator releases the hold after an International Team booking (hold.ts),
 * with a note saying why. The calendar and clash checks free the vehicles at once.
 */
export async function releaseHold(
  admin: Client,
  bookingId: string,
  userId: string,
  rawNote: unknown
): Promise<{ ok: true } | { ok: false; error: string }> {
  const note = typeof rawNote === "string" ? rawNote.trim() : "";
  if (!note) return { ok: false, error: "Write why the hold is being released." };
  if (note.length > 500) return { ok: false, error: "Keep the note under 500 characters." };
  const b = await loadReturnBooking(admin, bookingId);
  if (!b) return { ok: false, error: "That booking no longer exists." };
  if (b.purpose !== HOLD_PURPOSE) return { ok: false, error: "Only an International Team booking has a hold." };
  if (b.hold_released_at) return { ok: false, error: "The hold is already released." };
  if (!["pending", "approved", "completed"].includes(b.status)) return { ok: false, error: `This booking is ${b.status}: it holds nothing.` };
  const { error } = await admin
    .from("vehicle_bookings")
    .update({ hold_released_at: new Date().toISOString(), hold_released_by: userId, hold_release_note: note })
    .eq("id", bookingId);
  if (error) return saveFailed("Couldn’t release the hold", error);
  await refreshRentalAlerts(admin, bookingId);
  return { ok: true };
}
