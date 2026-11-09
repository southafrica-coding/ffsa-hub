import { NextResponse } from "next/server";
import { resolveEventSender } from "@/lib/email/event-sender";
import { wordingFor } from "@/lib/email/event-email-wording";
import { resolveEventBrand } from "@/lib/ticketing/fulfillment";
import { createClient } from "@/lib/supabase/server";
import {
  getFeedbackFormById,
  recordFeedbackSends,
  type FeedbackSendInsert,
} from "@/services/event-feedback";
import { sendTransactional } from "@/lib/email/send-transactional";
import { eventFeedbackRequestEmailHtml } from "@/lib/email/templates/event-feedback-request";
import { getAuthedUser } from "@/lib/api-auth";
import { canManageEvent, EVENT_CREATE_GATE, writeBlocked } from "@/lib/auth/event-access";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A debrief goes to a team, not a mailing list. The cap is a guard against
// someone pasting the whole contacts export into the box.
const MAX_RECIPIENTS = 200;

type Recipient = { email?: string; name?: string | null };

function siteBase(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://ffsahub.com";
  return raw.replace(/\/$/, "");
}

// POST /api/events/[id]/feedback/[formId]/send
// Body: { recipients: [{ email, name? }], kind?: 'invite' | 'reminder', note? }
//
// Emails the ONE public link to each address. There is no per-person
// token — the link is the same one on the QR code — so this is purely a
// convenience delivery plus an audit row of who was asked.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; formId: string }> }
) {
  const { id: eventId, formId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageEvent(supabase, user.id, EVENT_CREATE_GATE.keys, eventId, EVENT_CREATE_GATE))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: form, error: formErr } = await getFeedbackFormById(supabase, formId);
  if (writeBlocked(formErr)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (formErr) return NextResponse.json({ error: formErr.message }, { status: 500 });
  if (!form || form.event_id !== eventId) {
    return NextResponse.json({ error: "Feedback form not found" }, { status: 404 });
  }
  // Sending a link to a draft form would land people on "not available".
  if (form.status !== "open") {
    return NextResponse.json(
      { error: "Open the form before sending the link." },
      { status: 400 }
    );
  }

  let body: { recipients?: Recipient[]; kind?: "invite" | "reminder"; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const kind = body.kind === "reminder" ? "reminder" : "invite";

  // Normalise, validate and dedupe by address — a duplicated line in the
  // paste box shouldn't mean two emails.
  const seen = new Set<string>();
  const recipients: { email: string; name: string | null }[] = [];
  const invalid: string[] = [];
  for (const r of body.recipients ?? []) {
    const email = (r.email ?? "").trim().toLowerCase();
    if (!email) continue;
    if (!EMAIL_RE.test(email)) {
      invalid.push(email);
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    recipients.push({ email, name: r.name?.trim() || null });
  }

  if (!recipients.length) {
    return NextResponse.json(
      {
        error: invalid.length
          ? `No valid email addresses. Check: ${invalid.slice(0, 3).join(", ")}`
          : "Add at least one email address.",
      },
      { status: 400 }
    );
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return NextResponse.json(
      { error: `That's ${recipients.length} recipients — the limit is ${MAX_RECIPIENTS}.` },
      { status: 400 }
    );
  }

  const event = form.events as { title?: string } | null;
  // Sent as the event (its own email settings, migration 241, else its
  // brand's sender) so a reply reaches the Hub inbox, not a dead address.
  const { data: eventRow } = await supabase
    .from("events")
    .select("title, brand, public_slug, sending_identity_id, email_show_event_logo, logo_url, email_wording")
    .eq("id", eventId)
    .maybeSingle();
  const sender = await resolveEventSender(supabase, eventRow ?? {}, resolveEventBrand(eventRow ?? {}));
  const eventTitle = event?.title ?? "the event";
  const feedbackUrl = `${siteBase()}/fb/${form.slug}`;

  const sendRows: FeedbackSendInsert[] = [];
  let sent = 0;
  let failed = 0;

  for (const r of recipients) {
    // The greeting uses the first word of whatever name we were given —
    // "Hi Thandi," reads better than "Hi Thandi Mokoena,".
    const firstName = r.name ? r.name.split(/\s+/)[0] : null;
    // The event's own subject / message for this email (migration 242).
    const wording = wordingFor(eventRow?.email_wording, kind === "reminder" ? "feedback_reminder" : "feedback_invite", {
      firstName,
      eventTitle,
      defaultSubject:
        kind === "reminder"
          ? `A quick reminder — your feedback on ${eventTitle}`
          : `How did ${eventTitle} go? Your feedback, in 3 minutes`,
    });
    const html = eventFeedbackRequestEmailHtml({
      firstName,
      eventTitle,
      feedbackUrl,
      isReminder: kind === "reminder",
      isAnonymous: form.is_anonymous,
      note: body.note ?? null,
      siteUrl: siteBase(),
      headerLogoUrl: sender.headerLogoUrl,
      message: wording.message,
    });

    const result = await sendTransactional({
      to: r.email,
      subject: wording.subject,
      html,
      category: kind === "reminder" ? "event_feedback_reminder" : "event_feedback_invite",
      fromEmail: sender.fromEmail,
      fromName: sender.fromName,
      replyTo: sender.replyTo,
      sourceType: "event_feedback_form",
      sourceId: form.id,
    });

    if (result.ok) {
      sent += 1;
      sendRows.push({
        form_id: form.id,
        to_email: r.email,
        to_name: r.name,
        kind,
        status: "sent",
        sent_by: user.id,
      });
    } else {
      failed += 1;
      sendRows.push({
        form_id: form.id,
        to_email: r.email,
        to_name: r.name,
        kind,
        status: result.suppressed ? "suppressed" : "failed",
        error: result.error,
        sent_by: user.id,
      });
    }
  }

  // The emails have already gone out. A ledger failure must not look like
  // a refusal — staff would resend, and the same people would get it twice.
  const ledgerWarning = "Emails sent but the send log could not be saved; do not resend.";
  try {
    const recorded = await recordFeedbackSends(supabase, sendRows);
    const ledgerMissed =
      !!recorded.error || (sendRows.length > 0 && Array.isArray(recorded.data) && recorded.data.length === 0);
    if (ledgerMissed) {
      return NextResponse.json({
        sent,
        failed,
        total: recipients.length,
        invalid,
        warning: ledgerWarning,
      });
    }
  } catch {
    return NextResponse.json({
      sent,
      failed,
      total: recipients.length,
      invalid,
      warning: ledgerWarning,
    });
  }

  return NextResponse.json({ sent, failed, total: recipients.length, invalid });
}
