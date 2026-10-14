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

export const isVehicleView = (callbackId: string | undefined) => callbackId === VH_DENY_VIEW;

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

  const action = p.actions?.[0];
  if (!action) return ok();
  const bookingId = action.value ?? action.block_id?.replace(/^vh:/, "") ?? "";
  if (![VH_ASSIGN, VH_APPROVE, VH_DENY, VH_COMPLETE].includes(action.action_id) || !bookingId) return ok();

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
      .select("id, status, checkout_date, return_date")
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

    if (action.action_id === VH_COMPLETE) {
      if (booking.status !== "approved") {
        await refreshVehicleRequestAlerts(bookingId);
        return tell(p.response_url, `Already ${booking.status}.`);
      }
      const r = await decideVehicleBooking(admin, who.id, bookingId, "completed", null);
      if (!r.ok) await tell(p.response_url, r.error);
      await refreshVehicleRequestAlerts(bookingId);
    }
  });
  return ok();
}
