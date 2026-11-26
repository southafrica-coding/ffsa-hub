// Slack button clicks on the vehicle coordinator's DMs (lib/vehicles/slack-
// alerts). Called from /api/slack/interactions after signature verification.
// The clicker must be a Slack-linked Hub user with vehicle approve/manage
// rights. Slack wants a 3s ACK, so work runs in after(); the Deny modal opens
// before the ACK because its trigger_id expires in 3s.

import { after, NextResponse } from "next/server";
import * as slack from "@/lib/slack/client";
import { getVehicleAccess } from "@/services/vehicles";
import { decideVehicleBooking, assignVehiclesChecked } from "@/services/vehicle-decisions";
import {
  VH_ASSIGN,
  VH_APPROVE,
  VH_DENY,
  VH_COMPLETE,
  VH_DENY_VIEW,
  refreshVehicleRequestAlerts,
} from "@/lib/vehicles/slack-alerts";
import {
  VH_RETURNED,
  VH_EARLY_APPROVE,
  VH_EARLY_CALL,
  VH_EARLY_VIEW,
  markReturned,
  completeIfInspected,
  requestEarlyReturn,
  decideEarlyReturn,
  loadReturnBooking,
} from "@/lib/vehicles/rental-return";
import { RENTAL_RETURN_EARLY } from "@/lib/vehicles/rental-schedule";
import { fmtLong } from "@/lib/vehicles/rental-messages";

const sastToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());
const addDay = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Someone on the booking (who booked it, or a driver on the Hub), or a vehicle manager. */
async function bookingMember(admin: Client, slackUserId: string, bookingId: string): Promise<{ id: string } | { error: string }> {
  const { data } = await admin.from("users").select("id").eq("slack_user_id", slackUserId).maybeSingle();
  if (!data) return { error: "Your Slack isn't linked to a Hub account yet. Contact the Vehicle Coordinator." };
  const { data: b } = await admin.from("vehicle_bookings").select("requested_by, vehicle_booking_drivers(user_id)").eq("id", bookingId).maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onIt = b && (b.requested_by === data.id || ((b.vehicle_booking_drivers ?? []) as any[]).some((d) => d.user_id === data.id));
  if (onIt) return { id: data.id };
  const access = await getVehicleAccess(admin, data.id);
  if (access.isAdmin || access.canApprove || access.canManage) return { id: data.id };
  return { error: "Only the people on this booking can ask to return it early." };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type VehicleInteraction = {
  type: string;
  user: { id: string };
  trigger_id?: string;
  response_url?: string;
  actions?: { action_id: string; block_id?: string; value?: string; selected_options?: { value: string }[] }[];
  view?: { callback_id: string; private_metadata: string; state: { values: Record<string, Record<string, { value?: string | null }>> } };
};

const ok = () => new NextResponse(null, { status: 200 });

async function tell(responseUrl: string | undefined, text: string) {
  if (!responseUrl) return;
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_type: "ephemeral", replace_original: false, text }),
  }).catch(() => {});
}

async function approver(admin: Client, slackUserId: string): Promise<{ id: string } | { error: string }> {
  const { data } = await admin.from("users").select("id").eq("slack_user_id", slackUserId).maybeSingle();
  if (!data) return { error: "Your Slack isn't linked to a Hub account yet — link it on your Hub profile." };
  const access = await getVehicleAccess(admin, data.id);
  if (!(access.isAdmin || access.canApprove || access.canManage)) return { error: "Only vehicle approvers can do this." };
  return { id: data.id };
}

export const isVehicleView = (callbackId: string | undefined) => callbackId === VH_DENY_VIEW || callbackId === VH_EARLY_VIEW;

export async function handleVehicleInteraction(admin: Client, p: VehicleInteraction): Promise<NextResponse> {
  // ── Deny modal submitted ──
  if (p.type === "view_submission" && p.view?.callback_id === VH_DENY_VIEW) {
    const who = await approver(admin, p.user.id);
    if ("error" in who) return NextResponse.json({ response_action: "errors", errors: { reason: who.error } });
    const bookingId = p.view.private_metadata;
    const reason = (p.view.state.values.reason?.reason?.value ?? "").trim();
    after(async () => {
      const r = await decideVehicleBooking(admin, who.id, bookingId, "denied", reason);
      if (!r.ok) console.error("[vehicles/slack] deny failed", r.error);
      await refreshVehicleRequestAlerts(bookingId);
    });
    return ok(); // closes the modal
  }

  // ── Return early: the date was chosen ──
  if (p.type === "view_submission" && p.view?.callback_id === VH_EARLY_VIEW) {
    const bookingId = p.view.private_metadata;
    const who = await bookingMember(admin, p.user.id, bookingId);
    if ("error" in who) return NextResponse.json({ response_action: "errors", errors: { day: who.error } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const day = ((p.view.state.values.day?.day as any)?.selected_date as string | undefined) ?? "";
    const r = await requestEarlyReturn(admin, bookingId, who.id, day, sastToday());
    if (!r.ok) return NextResponse.json({ response_action: "errors", errors: { day: r.error } });
    return NextResponse.json({
      response_action: "update",
      view: {
        type: "modal",
        title: { type: "plain_text", text: "Return early" },
        close: { type: "plain_text", text: "Done" },
        blocks: [{ type: "section", text: { type: "mrkdwn", text: `✅ ${r.message}` } }],
      },
    });
  }

  const action = p.actions?.[0];
  if (!action) return ok();
  const bookingId = action.value ?? action.block_id?.replace(/^vh:/, "") ?? "";

  // ── Return early: open the date picker (anyone on the booking) ──
  if (action.action_id === RENTAL_RETURN_EARLY && bookingId) {
    const who = await bookingMember(admin, p.user.id, bookingId);
    if ("error" in who) {
      after(() => tell(p.response_url, who.error));
      return ok();
    }
    const b = await loadReturnBooking(admin, bookingId);
    if (b && p.trigger_id) {
      const today = sastToday();
      const latest = addDay(b.return_date, -1);
      await slack
        .openView(p.trigger_id, {
          type: "modal",
          callback_id: VH_EARLY_VIEW,
          private_metadata: bookingId,
          title: { type: "plain_text", text: "Return early" },
          submit: { type: "plain_text", text: "Ask the coordinator" },
          close: { type: "plain_text", text: "Cancel" },
          blocks: [
            { type: "section", text: { type: "mrkdwn", text: `*${b.booking_name}* is due back *${fmtLong(b.return_date)}*, before 12:00. Which day can you bring it back?` } },
            {
              type: "input",
              block_id: "day",
              label: { type: "plain_text", text: "Return on" },
              element: { type: "datepicker", action_id: "day", initial_date: today > latest ? latest : today },
            },
            { type: "context", elements: [{ type: "mrkdwn", text: "Before 12:00 that day, washed, with a full tank and the return checks done. The Vehicle Coordinator confirms." }] },
          ],
        })
        .catch((err) => console.error("[vehicles/slack] views.open failed", err));
    }
    return ok();
  }

  if (![VH_ASSIGN, VH_APPROVE, VH_DENY, VH_COMPLETE, VH_RETURNED, VH_EARLY_APPROVE, VH_EARLY_CALL].includes(action.action_id) || !bookingId) return ok();

  const who = await approver(admin, p.user.id);
  if ("error" in who) {
    after(() => tell(p.response_url, who.error));
    return ok();
  }

  if (action.action_id === VH_DENY) {
    if (p.trigger_id) {
      await slack
        .openView(p.trigger_id, {
          type: "modal",
          callback_id: VH_DENY_VIEW,
          private_metadata: bookingId,
          title: { type: "plain_text", text: "Deny request" },
          submit: { type: "plain_text", text: "Deny & email them" },
          close: { type: "plain_text", text: "Cancel" },
          blocks: [
            {
              type: "input",
              block_id: "reason",
              optional: true,
              label: { type: "plain_text", text: "Reason (emailed to the requester)" },
              element: {
                type: "plain_text_input",
                action_id: "reason",
                multiline: true,
                placeholder: { type: "plain_text", text: "e.g. No vans free those dates — try the following week" },
              },
            },
          ],
        })
        .catch((err) => console.error("[vehicles/slack] views.open failed", err));
    }
    return ok();
  }

  after(async () => {
    const { data: booking } = await admin
      .from("vehicle_bookings")
      .select("*") // "*": the hold columns (365) may not exist yet
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking) return tell(p.response_url, "That booking no longer exists.");

    if (action.action_id === VH_ASSIGN) {
      if (booking.status !== "pending" && booking.status !== "approved") {
        return tell(p.response_url, "This booking is closed — change vehicles in the Hub if needed.");
      }
      const ids = (action.selected_options ?? []).map((o) => o.value).filter((v) => v !== "none");
      const r = await assignVehiclesChecked(admin, booking, ids);
      if (!r.ok) await tell(p.response_url, r.error);
      await refreshVehicleRequestAlerts(bookingId);
      return;
    }

    if (action.action_id === VH_APPROVE) {
      if (booking.status !== "pending") {
        await refreshVehicleRequestAlerts(bookingId);
        return tell(p.response_url, `Already ${booking.status}.`);
      }
      const r = await decideVehicleBooking(admin, who.id, bookingId, "approved", null);
      if (!r.ok) await tell(p.response_url, r.error);
      await refreshVehicleRequestAlerts(bookingId);
      return;
    }

    if (action.action_id === VH_RETURNED) {
      const r = await markReturned(admin, bookingId, who.id);
      if (!r.ok) await tell(p.response_url, r.error);
      return;
    }

    if (action.action_id === VH_EARLY_APPROVE || action.action_id === VH_EARLY_CALL) {
      const r = await decideEarlyReturn(admin, bookingId, who.id, action.action_id === VH_EARLY_APPROVE);
      if (!r.ok) await tell(p.response_url, r.error);
      return;
    }

    if (action.action_id === VH_COMPLETE) {
      if (booking.status !== "approved") {
        await refreshVehicleRequestAlerts(bookingId);
        return tell(p.response_url, `Already ${booking.status}.`);
      }
      // Completed only once the post-rental inspection is recorded in Fleet (Gideon, 24 Nov).
      const r = await completeIfInspected(admin, bookingId, who.id);
      if (!r.ok) await tell(p.response_url, r.error);
      await refreshVehicleRequestAlerts(bookingId);
    }
  });
  return ok();
}
