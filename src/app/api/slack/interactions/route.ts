/**
 * POST /api/slack/interactions — Slack Interactivity request URL.
 *
 * Vehicle coordinator DM buttons are routed to lib/vehicles/slack-interactions.
 *
 * Handles the buttons on the prayer-room booking DM alerts
 * (lib/prayer-room/booking-alerts):
 *   • "Block out & notify" with a room picked → apply the block-out
 *   • "Block out & notify" with nothing / "Other…" picked → modal asking where
 *   • the modal's submit → apply with the typed location
 *   • "Dismiss" → dismiss the suggestion
 * The clicker must be a linked Hub user with prayer-room manage rights.
 *
 * Slack wants an ACK within 3s, so the real work runs in after(); the modal
 * is opened BEFORE the ACK because its trigger_id expires in 3s.
 *
 * Auth is by signing secret (lib/slack/verify), not session cookie — /api/slack
 * is in the middleware publicRoutes allowlist.
 */

import { after, NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/slack/verify";
import * as slack from "@/lib/slack/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPrayerRoomStaff } from "@/lib/auth/prayer-room-access";
import {
  getBookingSuggestions,
  applyBookingSuggestion,
  dismissBookingSuggestion,
} from "@/services/prayer-room-booking-suggestions";
import {
  ACTION_APPLY,
  ACTION_DISMISS,
  VIEW_OTHER,
  OTHER_VALUE,
  alertKeyOf,
  suggestionKeyOf,
  resolveBookingAlerts,
  displayName,
} from "@/lib/prayer-room/booking-alerts";
import { isVehicleAction } from "@/lib/vehicles/slack-alerts";
import { handleVehicleInteraction, isVehicleView, type VehicleInteraction } from "@/lib/vehicles/slack-interactions";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

type Payload = {
  type: "block_actions" | "view_submission" | string;
  user: { id: string };
  trigger_id?: string;
  response_url?: string;
  actions?: { action_id: string; value?: string; selected_option?: { value: string } }[];
  state?: { values: Record<string, Record<string, { selected_option?: { value: string } | null }>> };
  view?: {
    callback_id: string;
    private_metadata: string;
    state: { values: Record<string, Record<string, { value?: string | null }>> };
  };
};

/** Private reply under the alert, only the clicker sees it. */
async function tell(responseUrl: string | undefined, text: string) {
  if (!responseUrl) return;
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_type: "ephemeral", replace_original: false, text }),
  }).catch(() => {});
}

/** Linked Hub user who may manage the prayer room, or why not. */
async function manager(admin: Client, slackUserId: string): Promise<{ id: string } | { error: string }> {
  const { data } = await admin.from("users").select("id").eq("slack_user_id", slackUserId).maybeSingle();
  if (!data) return { error: "Your Slack isn't linked to a Hub account yet — link it on your Hub profile." };
  if (!(await isPrayerRoomStaff(admin, data.id))) return { error: "Only prayer room managers can do this." };
  return { id: data.id };
}

/** The live suggestion this alert was about — null if it moved or is gone. */
async function liveSuggestion(admin: Client, alertKey: string) {
  const { suggestions } = await getBookingSuggestions(admin);
  return suggestions.find((s) => alertKeyOf(s) === alertKey) ?? null;
}

async function apply(admin: Client, userId: string, alertKey: string, location: string, responseUrl?: string) {
  const s = await liveSuggestion(admin, alertKey);
  if (!s) {
    await tell(responseUrl, "This booking has changed or was already handled — check Prayer room → Manage.");
    return;
  }
  const result = await applyBookingSuggestion(admin, admin, userId, {
    bookingIds: s.occurrences.map((o) => o.bookingId),
    relocationNote: location,
    reason: null,
  });
  if ("error" in result) {
    await tell(responseUrl, `Couldn't block it out: ${result.error}`);
    return;
  }
  const name = await displayName(admin, userId);
  const slackNote = result.slack.ok ? "posted in #devo-sets" : `#devo-sets post failed (${result.slack.error ?? result.slack.skipped})`;
  await resolveBookingAlerts(
    result.suggestionKey,
    result.title,
    `✅ Blocked out by ${name} — ${result.affected} set${result.affected === 1 ? "" : "s"} moved to *${location}* · ${slackNote}.`
  );
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (
    !verifySlackSignature(
      rawBody,
      request.headers.get("x-slack-request-timestamp"),
      request.headers.get("x-slack-signature")
    )
  ) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let payload: Payload;
  try {
    payload = JSON.parse(new URLSearchParams(rawBody).get("payload") ?? "");
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }
  const admin = createAdminClient() as Client;

  // ── vehicle coordinator DMs (lib/vehicles/slack-alerts) ──
  if (
    isVehicleView(payload.view?.callback_id) ||
    (payload.type === "block_actions" && payload.actions?.[0] && isVehicleAction(payload.actions[0].action_id))
  ) {
    return handleVehicleInteraction(admin, payload as unknown as VehicleInteraction);
  }

  // ── the "Other…" modal ──
  if (payload.type === "view_submission" && payload.view?.callback_id === VIEW_OTHER) {
    const location = (payload.view.state.values.loc?.loc?.value ?? "").trim();
    if (!location) {
      return NextResponse.json({ response_action: "errors", errors: { loc: "Say where the sets are moving to" } });
    }
    const who = await manager(admin, payload.user.id);
    if ("error" in who) return NextResponse.json({ response_action: "errors", errors: { loc: who.error } });
    const alertKey = payload.view.private_metadata;
    after(() => apply(admin, who.id, alertKey, location));
    return new NextResponse(null, { status: 200 }); // closes the modal
  }

  if (payload.type !== "block_actions" || !payload.actions?.length) {
    return new NextResponse(null, { status: 200 });
  }

  const action = payload.actions[0];
  if (action.action_id !== ACTION_APPLY && action.action_id !== ACTION_DISMISS) {
    // The dropdown and the "Open in Hub" link need nothing from us.
    return new NextResponse(null, { status: 200 });
  }

  const who = await manager(admin, payload.user.id);
  if ("error" in who) {
    after(() => tell(payload.response_url, who.error));
    return new NextResponse(null, { status: 200 });
  }
  const alertKey = action.value ?? "";

  if (action.action_id === ACTION_DISMISS) {
    after(async () => {
      const s = await liveSuggestion(admin, alertKey);
      if (!s) return tell(payload.response_url, "This booking has changed or was already handled.");
      const r = await dismissBookingSuggestion(admin, admin, who.id, s.occurrences.map((o) => o.bookingId));
      if (r.error) return tell(payload.response_url, `Couldn't dismiss: ${r.error}`);
      const name = await displayName(admin, who.id);
      await resolveBookingAlerts(suggestionKeyOf(alertKey), s.title, `✖️ Dismissed by ${name} — devo sets stay put.`);
    });
    return new NextResponse(null, { status: 200 });
  }

  // Apply: the picked room comes from the dropdown in the same message.
  const picked = payload.state?.values?.pr_alert?.pr_alert_move?.selected_option?.value ?? null;
  if (!picked || picked === OTHER_VALUE) {
    if (payload.trigger_id) {
      await slack
        .openView(payload.trigger_id, {
          type: "modal",
          callback_id: VIEW_OTHER,
          private_metadata: alertKey,
          title: { type: "plain_text", text: "Block out" },
          submit: { type: "plain_text", text: "Block out & notify" },
          close: { type: "plain_text", text: "Cancel" },
          blocks: [
            {
              type: "input",
              block_id: "loc",
              label: { type: "plain_text", text: "Where are the devo sets moving to?" },
              element: {
                type: "plain_text_input",
                action_id: "loc",
                placeholder: { type: "plain_text", text: "e.g. Office 2 — look for the sign" },
              },
            },
          ],
        })
        .catch((err) => console.error("[slack/interactions] views.open failed", err));
    }
    return new NextResponse(null, { status: 200 });
  }

  after(() => apply(admin, who.id, alertKey, picked, payload.response_url));
  return new NextResponse(null, { status: 200 });
}
