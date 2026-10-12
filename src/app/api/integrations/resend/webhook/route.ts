import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  applyProviderEvent,
  type NormalizedDeliveryEvent,
} from "@/lib/email/ledger";
import { recordConsentEvent } from "@/lib/consent/record";

// POST /api/integrations/resend/webhook
//
// Resend posts delivery events here (configure at resend.com → Webhooks,
// pointed at https://<site>/api/integrations/resend/webhook, with the
// delivered / opened / clicked / bounced / complained events). Each event
// carries data.email_id — the id we stored at send time — and is reconciled
// in three places:
//
//   1. email_messages (the unified ledger): status advances sent →
//      delivered/opened/bounced/complained. Every Resend send has a row here.
//   2. campaign_recipients or workflow_email_sends: the per-campaign and
//      per-automation books that the analytics screens count, plus a line on
//      the contact's timeline for opens, clicks, bounces and complaints.
//   3. email_link_clicks: every click, with the link that was clicked, so a
//      campaign can show which links got clicked and how often.
//
// Hard bounces and complaints also feed the global suppression list, and a
// complaint is logged as a POPIA objection.
//
// Signing: Resend uses Svix. We verify the svix-id / svix-timestamp /
// svix-signature triple against RESEND_WEBHOOK_SECRET (whsec_...). If the
// secret isn't configured yet we accept + log a warning, so wiring the
// endpoint before pasting the secret doesn't silently drop events —
// but set it: an unsigned public endpoint is spoofable.

export const runtime = "nodejs";

// Verify a Svix-style signature. signedContent = `${id}.${ts}.${body}`;
// the secret is base64 after the `whsec_` prefix; the header is a
// space-separated list of `v1,<base64sig>` — any match passes.
function verifySvix(
  secret: string,
  id: string | null,
  timestamp: string | null,
  signatureHeader: string | null,
  body: string
): boolean {
  if (!id || !timestamp || !signatureHeader) return false;
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${id}.${timestamp}.${body}`;
  const expected = createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);
  for (const part of signatureHeader.split(" ")) {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    const sigBuf = Buffer.from(sig);
    if (
      sigBuf.length === expectedBuf.length &&
      timingSafeEqual(sigBuf, expectedBuf)
    ) {
      return true;
    }
  }
  return false;
}

// Map a Resend event type onto our normalized ledger status. Types we
// don't track (email.sent, email.delivery_delayed, email.scheduled) map
// to null and are acknowledged without touching the row.
function normalize(payload: {
  type?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
}): NormalizedDeliveryEvent | null {
  const emailId = payload.data?.email_id ?? payload.data?.id;
  if (!emailId) return null;
  const base = { providerMessageId: String(emailId), raw: payload };
  switch (payload.type) {
    case "email.delivered":
      return { ...base, status: "delivered" };
    case "email.opened":
    case "email.clicked":
      return { ...base, status: "opened" };
    case "email.bounced": {
      const kind = String(payload.data?.bounce?.type ?? "").toLowerCase();
      return {
        ...base,
        status: "bounced",
        bounceType: kind.includes("transient") ? "soft" : "hard",
        reason:
          payload.data?.bounce?.message ??
          payload.data?.bounce?.subType ??
          "bounced",
      };
    }
    case "email.complained":
      return { ...base, status: "complained", reason: "spam complaint" };
    default:
      return null;
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  const eventId = request.headers.get("svix-id");

  if (secret) {
    const ok = verifySvix(
      secret,
      eventId,
      request.headers.get("svix-timestamp"),
      request.headers.get("svix-signature"),
      rawBody
    );
    if (!ok) {
      console.error("[resend/webhook] signature verification failed");
      return new NextResponse("invalid signature", { status: 401 });
    }
  } else {
    console.warn(
      "[resend/webhook] RESEND_WEBHOOK_SECRET not set — accepting unverified event"
    );
  }

  let payload: ResendEvent;
  try {
    payload = JSON.parse(rawBody) as ResendEvent;
  } catch {
    return new NextResponse("bad json", { status: 400 });
  }

  const ev = normalize(payload);
  if (!ev) return NextResponse.json({ ok: true, ignored: true });

  const admin = createAdminClient();

  // 1. Unified ledger.
  const matched = await applyProviderEvent(admin, "resend", ev);

  // 2 + 3. Campaign / automation books, timeline, link clicks.
  await reconcileSendBooks(admin, payload, ev, eventId);

  // Hard bounces + complaints feed the global suppression list — a bad
  // address is bad on every channel. A transient (soft) bounce is a full
  // mailbox or a slow server; suppressing it would drop a real person.
  const isHardBounce = ev.status === "bounced" && ev.bounceType === "hard";
  if (isHardBounce || ev.status === "complained") {
    const to = payload.data?.to;
    const email = Array.isArray(to) ? to[0] : to;
    if (typeof email === "string" && email.includes("@")) {
      const normalizedEmail = email.trim().toLowerCase();
      await admin.from("email_suppressions").upsert(
        {
          email_normalized: normalizedEmail,
          reason: ev.status === "complained" ? "complaint" : "hard_bounce",
        },
        { onConflict: "email_normalized", ignoreDuplicates: true }
      );

      // A spam complaint is an objection under POPIA, so it belongs in the
      // consent log as well as the suppression list (migration 187). A
      // bounce is not — a broken mailbox says nothing about what she wants.
      if (ev.status === "complained") {
        const { data: contact } = await admin
          .from("contacts")
          .select("id")
          .eq("email_normalized", normalizedEmail)
          .maybeSingle();
        if (contact?.id) {
          await recordConsentEvent(admin, {
            contactId: contact.id,
            kind: "objected",
            source: "complaint",
            evidence: { note: "Marked as spam at the provider" },
          });
        }
      }
    }
  }

  return NextResponse.json({ ok: true, matched });
}

type ResendEvent = {
  type?: string;
  created_at?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/**
 * Advance the campaign_recipients or workflow_email_sends row that owns this
 * message, put opens/clicks/bounces/complaints on the contact timeline, and
 * log every click with its link.
 *
 * opened_at and first_clicked_at keep the FIRST time — later opens and clicks
 * don't move them. A click also stamps opened_at if no open was seen, since
 * clicking means she opened it even when her mail app blocked the open pixel.
 */
async function reconcileSendBooks(
  admin: Admin,
  payload: ResendEvent,
  ev: NormalizedDeliveryEvent,
  eventId: string | null
) {
  const at = payload.data?.click?.timestamp ?? payload.created_at ?? new Date().toISOString();
  const isClick = payload.type === "email.clicked";

  const { data: recipient } = await admin
    .from("campaign_recipients")
    .select("id, campaign_id, contact_id, opened_at, first_clicked_at")
    .eq("provider_message_id", ev.providerMessageId)
    .maybeSingle();
  const wsend = recipient
    ? null
    : (
        await admin
          .from("workflow_email_sends")
          .select("id, workflow_id, contact_id, outcome_label_id, opened_at, first_clicked_at")
          .eq("provider_message_id", ev.providerMessageId)
          .maybeSingle()
      ).data;
  const row = recipient ?? wsend;
  if (!row) return; // transactional mail — the ledger alone tracks it

  const patch: Record<string, unknown> = {};
  let activityType: string | null = null;
  switch (ev.status) {
    case "delivered":
      patch.delivered_at = at;
      break;
    case "opened":
      if (!row.opened_at) patch.opened_at = at;
      if (isClick) {
        if (!row.first_clicked_at) patch.first_clicked_at = at;
        activityType = "email_clicked";
      } else {
        // One timeline line per person per email, not one per re-open.
        activityType = row.opened_at ? null : "email_opened";
      }
      break;
    case "bounced":
      patch.bounced_at = at;
      patch.bounce_reason = ev.reason ?? "bounced";
      activityType = "email_bounced";
      break;
    case "complained":
      patch.complained_at = at;
      activityType = "email_complained";
      break;
  }

  const table = recipient ? "campaign_recipients" : "workflow_email_sends";
  if (Object.keys(patch).length > 0) {
    await admin.from(table).update(patch).eq("id", row.id);
  }

  const url: string | null =
    isClick && typeof payload.data?.click?.link === "string"
      ? payload.data.click.link
      : null;

  // Every click, with its link. A retried webhook carries the same svix-id,
  // and the unique index on event_id turns the retry into a no-op.
  let newClick = true;
  if (url) {
    const { data: inserted, error } = await admin
      .from("email_link_clicks")
      .upsert(
        {
          event_id: eventId,
          provider: "resend",
          provider_message_id: ev.providerMessageId,
          campaign_id: recipient?.campaign_id ?? null,
          workflow_id: wsend?.workflow_id ?? null,
          contact_id: row.contact_id ?? null,
          url,
          user_agent:
            typeof payload.data?.click?.userAgent === "string"
              ? payload.data.click.userAgent.slice(0, 500)
              : null,
          clicked_at: at,
        },
        { onConflict: "event_id", ignoreDuplicates: true }
      )
      .select("id");
    newClick = !error && (inserted ?? []).length > 0;
  }

  if (activityType && row.contact_id && newClick) {
    await admin.from("activity_events").insert(
      recipient
        ? {
            contact_id: recipient.contact_id,
            event_type: activityType,
            related_campaign_id: recipient.campaign_id,
            occurred_at: at,
            ...(url ? { payload: { url } } : {}),
          }
        : {
            contact_id: wsend.contact_id,
            event_type: activityType,
            related_label_id: wsend.outcome_label_id ?? null,
            occurred_at: at,
            payload: { workflow_id: wsend.workflow_id, source: "workflow", ...(url ? { url } : {}) },
          }
    );
  }
}
