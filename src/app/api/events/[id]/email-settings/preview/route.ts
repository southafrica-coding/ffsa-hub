import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { canManageEvent, EVENT_UPDATE_GATE } from "@/lib/auth/event-access";
import { resolveEventBrand } from "@/lib/ticketing/fulfillment";
import { resolveEventSender } from "@/lib/email/event-sender";
import { EVENT_EMAILS, cleanWording, wordingFor, type EventEmailKey } from "@/lib/email/event-email-wording";
import { ticketEmailHtml, ticketEmailSubject } from "@/lib/ticketing/ticket-email";
import { refundConfirmationEmailHtml } from "@/lib/email/templates/refund-confirmation";
import { eventCancellationNoticeEmailHtml } from "@/lib/email/templates/event-cancellation-notice";
import { eventFeedbackRequestEmailHtml } from "@/lib/email/templates/event-feedback-request";
import { renderInvoiceEmail } from "@/lib/finance/invoice-email";
import { REFUND_LINE } from "@/services/event-cancellation-notice";
import { defaultTemplate } from "@/lib/ticketing/pay-later";
import { INVOICE_SENDER } from "@/services/invoice-email-delivery";
import { sendTransactional } from "@/lib/email/send-transactional";

// POST /api/events/[id]/email-settings/preview
//   { key, wording?, send?: boolean }
//
// Renders one of the event's emails exactly as a buyer would get it — the
// event's sender, logo and (unsaved) wording — on sample data: the signed-in
// person as the buyer, the event's first ticket tier. send: true emails it
// to the signed-in person, subject prefixed [TEST]. Nothing else is sent and
// nothing is saved.

export const maxDuration = 30;

const SITE = () => (process.env.NEXT_PUBLIC_SITE_URL || "https://www.ffsahub.com").replace(/\/$/, "");

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-ZA", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : "Date to be confirmed";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageEvent(supabase, user.id, EVENT_UPDATE_GATE.keys, id, EVENT_UPDATE_GATE))) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const b = await request.json().catch(() => ({}));
  const key = b.key as EventEmailKey;
  if (!(key in EVENT_EMAILS)) return NextResponse.json({ error: "Unknown email" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: event } = await admin
    .from("events")
    .select(
      "id, title, brand, public_slug, start_date, end_date, location, currency, cancellation_message, pay_later_due_date, logo_url, sending_identity_id, email_show_event_logo, email_wording"
    )
    .eq("id", id)
    .maybeSingle();
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  const { data: me } = await admin.from("users").select("first_name, email").eq("id", user.id).maybeSingle();
  const { data: tier } = await admin
    .from("ticket_types")
    .select("name, display_price_cents")
    .eq("event_id", id)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  // The wording being edited (unsaved) wins over what's stored.
  const wordingSource = b.wording !== undefined ? { [key]: cleanWording({ [key]: b.wording })[key] } : event.email_wording;
  const brand = resolveEventBrand(event);
  const sender = await resolveEventSender(admin, event, brand);
  const firstName = (me?.first_name as string | null) || "Jack";
  const currency = (event.currency as string | null) ?? "ZAR";
  const totalCents = (tier?.display_price_cents as number | null) ?? 50000;
  const title = event.title as string;
  const site = SITE();
  const w = (defaultSubject: string) => wordingFor(wordingSource, key, { firstName, eventTitle: title, defaultSubject });

  let subject = "";
  let html = "";
  let replyTo = sender.replyTo;
  let fromName = sender.fromName;
  let note: string | null = null;

  switch (key) {
    case "ticket_confirmation": {
      const x = w(ticketEmailSubject(brand, title));
      subject = x.subject;
      html = ticketEmailHtml(brand, {
        buyerFirstName: firstName,
        eventTitle: title,
        eventDate: fmtDate(event.start_date),
        eventLocation: event.location ?? null,
        tickets: [{ code: "SAMPLE-TICKET", tierName: (tier?.name as string) ?? "General" }],
        orderId: "00000000-sample",
        totalCents,
        currency,
        siteUrl: site,
        headerLogoUrl: sender.headerLogoUrl,
        message: x.message,
      });
      break;
    }
    case "refund": {
      const x = w(`Your refund for ${title}`);
      subject = x.subject;
      html = refundConfirmationEmailHtml({
        buyerFirstName: firstName,
        eventTitle: title,
        orderId: "00000000-sample",
        refundedCents: totalCents,
        totalRefundedCents: totalCents,
        orderTotalCents: totalCents,
        isFullRefund: true,
        currency,
        cancellationMessage: null,
        siteUrl: site,
        headerLogoUrl: sender.headerLogoUrl,
        message: x.message,
      });
      break;
    }
    case "cancellation_notice": {
      subject = w(`${title} has been cancelled`).subject;
      html = eventCancellationNoticeEmailHtml({
        eventTitle: title,
        message: event.cancellation_message?.trim() || "(The cancellation reason you write when you cancel the event appears here.)",
        refundLine: REFUND_LINE,
        siteUrl: site,
        headerLogoUrl: sender.headerLogoUrl,
      });
      break;
    }
    case "feedback_invite":
    case "feedback_reminder": {
      const reminder = key === "feedback_reminder";
      const x = w(
        reminder ? `A quick reminder — your feedback on ${title}` : `How did ${title} go? Your feedback, in 3 minutes`
      );
      subject = x.subject;
      html = eventFeedbackRequestEmailHtml({
        firstName,
        eventTitle: title,
        feedbackUrl: `${site}/fb/sample`,
        isReminder: reminder,
        isAnonymous: false,
        note: null,
        siteUrl: site,
        headerLogoUrl: sender.headerLogoUrl,
        message: x.message,
      });
      break;
    }
    case "pay_later_invoice": {
      // SA template shown; a USA buyer gets the US one, same wording.
      const template = await defaultTemplate(admin, "za");
      if (!template) return NextResponse.json({ error: "No SA invoice email template found." }, { status: 500 });
      const x = w("");
      const amount = totalCents / 100;
      const email = renderInvoiceEmail(template, {
        contactFirstName: firstName,
        contactName: firstName,
        tradingName: "Fire & Fragrance SA NPC",
        invoiceNumber: "INV-SAMPLE",
        currencyCode: currency,
        invoiceTotal: amount,
        amountDue: amount,
        dueDate: (event.pay_later_due_date ?? event.start_date ?? new Date().toISOString()).slice(0, 10),
        onlineInvoiceUrl: "https://in.xero.com/sample",
        headerLogoUrl: sender.headerLogoUrl,
        message: x.message,
      });
      subject = x.subject || email.subject;
      html = email.html;
      replyTo = INVOICE_SENDER.replyTo;
      fromName = sender.fromName;
      note = "Shown with the SA invoice template — buyers from the USA get the US one with its Stripe link. The real email attaches the Xero PDF.";
      break;
    }
  }

  const from = { name: fromName, email: sender.fromEmail, replyTo };

  if (b.send === true) {
    const to = (me?.email as string | null) ?? null;
    if (!to) return NextResponse.json({ error: "Your account has no email address." }, { status: 400 });
    const sent = await sendTransactional({
      to,
      subject: `[TEST] ${subject}`,
      html,
      category: "event_email_test",
      fromEmail: from.email,
      fromName: from.name,
      replyTo: from.replyTo,
      sourceType: "event",
      sourceId: id,
      reason: `Test of ${title}'s ${EVENT_EMAILS[key].name.toLowerCase()} email`,
    });
    if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: 502 });
    return NextResponse.json({ ok: true, sentTo: to });
  }

  return NextResponse.json({ subject, html, from, note });
}
