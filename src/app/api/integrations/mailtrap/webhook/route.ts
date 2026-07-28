import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  applyProviderEvent,
  type NormalizedDeliveryEvent,
} from "@/lib/email/ledger";

// POST /api/integrations/mailtrap/webhook — Mailtrap delivery events.
// Mailtrap posts { events: [ { event, message_id, email, ... } ] }.
// We reconcile against campaign_recipients.provider_message_id and
// update the matching timestamp column + the contact timeline.
export async function POST(request: Request) {
  // Optional shared-secret gate. When MAILTRAP_WEBHOOK_SECRET is set, Mailtrap
  // must call this endpoint with ?token=<secret>; otherwise anyone could POST
  // fake delivery events. Left open when unset to avoid breaking an existing
  // registration before the secret is configured.
  const secret = process.env.MAILTRAP_WEBHOOK_SECRET;
  if (secret) {
    const token = new URL(request.url).searchParams.get("token");
    if (token !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const admin = createAdminClient();

  let body: { events?: MailtrapEvent[] } | MailtrapEvent[];
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const events: MailtrapEvent[] = Array.isArray(body) ? body : body.events ?? [];

  let handled = 0;
  for (const ev of events) {
    if (!ev?.message_id) continue;

    const at = ev.timestamp
      ? new Date(ev.timestamp * 1000).toISOString()
      : new Date().toISOString();

    const patch: Record<string, unknown> = {};
    let activityType: string | null = null;

    switch (ev.event) {
      case "delivery":
        patch.delivered_at = at;
        break;
      case "open":
        patch.opened_at = at;
        activityType = "email_opened";
        break;
      case "click":
        patch.first_clicked_at = at;
        activityType = "email_clicked";
        break;
      case "bounce":
      case "soft bounce":
      case "suspension":
        patch.bounced_at = at;
        patch.bounce_reason = ev.reason ?? ev.event;
        activityType = "email_bounced";
        break;
      case "spam":
        patch.complained_at = at;
        activityType = "email_complained";
        break;
      case "unsubscribe":
        patch.unsubscribed_at = at;
        activityType = "email_unsubscribed";
        break;
      default:
        continue;
    }

    // Reconcile against a campaign send first, then a workflow send.
    // Opens/clicks/bounces/complaints go on the contact timeline;
    // deliveries are skipped to avoid timeline noise.
    const { data: recipient } = await admin
      .from("campaign_recipients")
      .select("id, campaign_id, contact_id")
      .eq("provider_message_id", ev.message_id)
      .maybeSingle();

    if (recipient) {
      await admin.from("campaign_recipients").update(patch).eq("id", recipient.id);
      if (activityType && recipient.contact_id) {
        await admin.from("activity_events").insert({
          contact_id: recipient.contact_id,
          event_type: activityType,
          related_campaign_id: recipient.campaign_id,
          occurred_at: at,
        });
      }
    } else {
      const { data: wsend } = await admin
        .from("workflow_email_sends")
        .select("id, workflow_id, contact_id, outcome_label_id")
        .eq("provider_message_id", ev.message_id)
        .maybeSingle();

      if (wsend) {
        await admin.from("workflow_email_sends").update(patch).eq("id", wsend.id);
        if (activityType && wsend.contact_id) {
          await admin.from("activity_events").insert({
            contact_id: wsend.contact_id,
            event_type: activityType,
            related_label_id: wsend.outcome_label_id ?? null,
            occurred_at: at,
            payload: { workflow_id: wsend.workflow_id, source: "workflow" },
          });
        }
      } else {
        // Third bucket: transactional / ticket emails logged in the
        // email_messages ledger (migration 141). Neither a campaign nor a
        // workflow row owns this message id, so reconcile it there.
        // applyProviderEvent is a no-op for an unknown id, so a genuinely
        // stray event just falls through to the suppression feed below.
        const normalized = normalizeForLedger(ev);
        if (normalized) await applyProviderEvent(admin, "mailtrap", normalized);
      }
    }

    // Hard bounces + complaints feed the global suppression list (both paths).
    if ((ev.event === "bounce" || ev.event === "spam") && ev.email) {
      await admin
        .from("email_suppressions")
        .upsert(
          {
            email_normalized: ev.email.trim().toLowerCase(),
            reason: ev.event === "spam" ? "complaint" : "hard_bounce",
          },
          { onConflict: "email_normalized", ignoreDuplicates: true }
        );
    }

    handled++;
  }

  return NextResponse.json({ handled });
}

type MailtrapEvent = {
  event?: string;
  message_id?: string;
  email?: string;
  timestamp?: number;
  reason?: string;
};

// Map a Mailtrap delivery event onto the email_messages ledger's
// normalized shape (migration 141). Returns null for events the ledger
// doesn't model (e.g. unsubscribe), which are handled elsewhere.
function normalizeForLedger(
  ev: MailtrapEvent
): NormalizedDeliveryEvent | null {
  if (!ev.message_id) return null;
  const base = { providerMessageId: String(ev.message_id), raw: ev };
  switch (ev.event) {
    case "delivery":
      return { ...base, status: "delivered" };
    case "open":
    case "click":
      return { ...base, status: "opened" };
    case "bounce":
      return { ...base, status: "bounced", bounceType: "hard", reason: ev.reason ?? "bounced" };
    case "soft bounce":
      return { ...base, status: "bounced", bounceType: "soft", reason: ev.reason ?? "soft bounce" };
    case "suspension":
      return { ...base, status: "dropped", reason: ev.reason ?? "suspension" };
    case "spam":
      return { ...base, status: "complained", reason: "spam complaint" };
    default:
      return null;
  }
}
