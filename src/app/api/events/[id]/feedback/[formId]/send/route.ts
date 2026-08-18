import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getFeedbackFormById,
  recordFeedbackSends,
  type FeedbackSendInsert,
} from "@/services/event-feedback";
import { sendTransactional } from "@/lib/email/send-transactional";
import { eventFeedbackRequestEmailHtml } from "@/lib/email/templates/event-feedback-request";
import { getAuthedUser, canManageEvents } from "@/lib/api-auth";

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
  if (!(await canManageEvents(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: form } = await getFeedbackFormById(supabase, formId);
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
  const eventTitle = event?.title ?? "the event";
  const feedbackUrl = `${siteBase()}/fb/${form.slug}`;

  const sendRows: FeedbackSendInsert[] = [];
  let sent = 0;
  let failed = 0;

  for (const r of recipients) {
    // The greeting uses the first word of whatever name we were given —
    // "Hi Thandi," reads better than "Hi Thandi Mokoena,".
    const firstName = r.name ? r.name.split(/\s+/)[0] : null;
    const html = eventFeedbackRequestEmailHtml({
      firstName,
      eventTitle,
      feedbackUrl,
      isReminder: kind === "reminder",
      isAnonymous: form.is_anonymous,
      note: body.note ?? null,
      siteUrl: siteBase(),
    });

    const result = await sendTransactional({
      to: r.email,
      subject:
        kind === "reminder"
          ? `A quick reminder — your feedback on ${eventTitle}`
          : `How did ${eventTitle} go? Your feedback, in 3 minutes`,
      html,
      category: kind === "reminder" ? "event_feedback_reminder" : "event_feedback_invite",
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

  // The audit rows are best-effort: a ledger hiccup must not report a
  // successful send as a failure.
  await recordFeedbackSends(supabase, sendRows);

  return NextResponse.json({ sent, failed, total: recipients.length, invalid });
}
