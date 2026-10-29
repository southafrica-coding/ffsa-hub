// FFSA Hub — Ticket fulfilment.
//
// Called whenever an order transitions to `paid` (PayFast webhook
// today, Stripe in v1.5, future comp-code branch). One shared
// entry point keeps every path consistent.
//
// Steps:
//   1. Load the order (+ event, + existing tickets for idempotency).
//   2. If no tickets yet, generate codes from order.lines and bulk
//      insert into the tickets table.
//   3. Generate QR codes (data URIs) for each ticket.
//   4. Send the confirmation email via Resend (transactional).
//
// Idempotent: safe to invoke more than once for the same order —
// the tickets-by-order lookup short-circuits re-issuance, and the
// email re-sends (acceptable for retries).

import { resolveEventSender } from "@/lib/email/event-sender";
import { wordingFor } from "@/lib/email/event-email-wording";
import { ticketEmailHtml, ticketEmailSubject } from "./ticket-email";
import { randomBytes } from "node:crypto";
import { sendViaResend, isEmailConfigured } from "@/lib/email/resend-send";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordEmail, markSent, markFailed } from "@/lib/email/ledger";
import { resolveOrderToCrm } from "./crm-resolution";
import {
  ticketAnswerDrainer,
  type TicketAnswerGroup,
} from "./ticket-questions";
import {
  waiverSignatureDrainer,
  type WaiverSignatureGroup,
  type WaiverSignatureRecord,
} from "./waivers";
import { renderWaiverCertificate } from "./render-waiver-certificate";
import { ticketWaivedSteps, type OrderWaivedSteps } from "./promo-codes";

export type EventBrand =
  | "ff"
  | "the_send"
  | "ffsa_camps"
  | "preachers"
  | "wild_ones"
  | "missio";

// Bespoke email keyed by the event's brand flag (migration 077 + the
// ffsa_camps follow-up). An explicit brand always wins. Falls back to a
// slug/title heuristic only for unmigrated rows (brand null/empty) so
// they still route to a bespoke template when the slug/title is
// unambiguous. Once every event row has its brand set deliberately, the
// heuristic can be dropped.
export function resolveEventBrand(event: {
  brand?: string | null;
  public_slug?: string | null;
  title?: string | null;
}): EventBrand {
  if (event.brand === "the_send") return "the_send";
  if (event.brand === "ffsa_camps") return "ffsa_camps";
  if (event.brand === "preachers") return "preachers";
  if (event.brand === "wild_ones") return "wild_ones";
  if (event.brand === "missio") return "missio";
  if (event.brand) return "ff"; // explicit (incl. 'ff' / unknown) → no heuristic
  const slug = (event.public_slug ?? "").toLowerCase();
  const title = (event.title ?? "").toLowerCase();
  if (slug.includes("the-send") || title.includes("the send")) return "the_send";
  if (slug.includes("ffsa-camps") || slug.includes("camps") || title.includes("camps"))
    return "ffsa_camps";
  if (slug.includes("preachers") || title.includes("preachers")) return "preachers";
  if (slug.includes("wild-ones") || slug.includes("wild ones") || title.includes("wild ones"))
    return "wild_ones";
  if (slug.includes("missio") || title.includes("missio")) return "missio";
  return "ff";
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

type OrderLine = {
  ticket_type_id: string;
  qty: number;
  per_ticket_cents: number;
};

// 8 bytes of randomness → ~11 chars base64url. ~10^19 keyspace —
// effectively zero collision risk even at millions of tickets.
function generateTicketCode(): string {
  return randomBytes(8).toString("base64url");
}

function formatEventDate(start: string, end: string | null): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  };
  const startD = new Date(start + "T00:00:00").toLocaleDateString(undefined, opts);
  if (end && end !== start) {
    const endD = new Date(end + "T00:00:00").toLocaleDateString(undefined, opts);
    return `${startD} – ${endD}`;
  }
  return startD;
}

export async function fulfillOrder(
  supabase: Client,
  orderId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  // 1. Load order + event (brand drives the email template).
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select(
      "id, status, total_cents, currency, buyer_first_name, buyer_last_name, buyer_email, buyer_contact_id, lines, ticket_answers, waiver_signatures, promo_code_id, promo_code, waived_steps, event_id, events(id, title, start_date, end_date, location, public_slug, brand, sending_identity_id, email_show_event_logo, logo_url, email_wording)"
    )
    .eq("id", orderId)
    .maybeSingle();
  if (orderErr || !order) {
    return { ok: false, error: `Order ${orderId} not found` };
  }
  if (order.status !== "paid") {
    return {
      ok: false,
      error: `Order ${orderId} is not paid (status: ${order.status})`,
    };
  }
  if (!order.events) {
    return { ok: false, error: `Order ${orderId} has no event` };
  }

  // 2. Idempotency: if tickets already exist for this order, skip
  //    issuance and just resend the email.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tickets: any[];
  {
    const { data: existing } = await supabase
      .from("tickets")
      .select("id, code, ticket_type_id, waiver_signature, ticket_types(name)")
      .eq("order_id", orderId)
      .order("created_at");
    tickets = existing ?? [];
  }

  if (tickets.length === 0) {
    const lines = (order.lines as OrderLine[]) ?? [];
    if (lines.length === 0) {
      return { ok: false, error: `Order ${orderId} has no lines to fulfil` };
    }
    // Drain the per-ticket answers captured at checkout onto each issued
    // ticket. Grouped by tier (FIFO), so the i-th kids ticket gets the
    // i-th kids answer set; tiers without questions get an empty [].
    const drainAnswers = ticketAnswerDrainer(
      (order.ticket_answers as TicketAnswerGroup[] | null) ?? []
    );
    // Drain the signed waivers captured at checkout onto each issued
    // ticket (FIFO per tier), same shape as the answers drain.
    const drainWaiver = waiverSignatureDrainer(
      (order.waiver_signatures as WaiverSignatureGroup[] | null) ?? []
    );
    // Every ticket records the promo code it was sold with and what that
    // code waived for its tier (migration 269), so a skipped waiver or
    // question reads as "waived" rather than missing.
    const orderWaivedSteps = (order.waived_steps as OrderWaivedSteps[] | null) ?? [];
    const ticketRows = lines.flatMap((line) =>
      Array.from({ length: line.qty }, () => ({
        order_id: orderId,
        event_id: order.event_id,
        ticket_type_id: line.ticket_type_id,
        code: generateTicketCode(),
        custom_answers: drainAnswers(line.ticket_type_id),
        waiver_signature: drainWaiver(line.ticket_type_id),
        promo_code_id: order.promo_code_id ?? null,
        waived_steps: ticketWaivedSteps(
          orderWaivedSteps,
          order.promo_code,
          line.ticket_type_id
        ),
      }))
    );
    const { data: inserted, error: insertErr } = await supabase
      .from("tickets")
      .insert(ticketRows)
      .select("id, code, ticket_type_id, waiver_signature, ticket_types(name)");
    if (insertErr || !inserted) {
      return {
        ok: false,
        error: `Failed to issue tickets: ${insertErr?.message ?? "unknown"}`,
      };
    }
    tickets = inserted;
  }

  // 2b. Render + store the signed waiver certificate for any ticket that
  //     carries a signature but doesn't yet have a certificate PDF. Best
  //     effort and idempotent (skips tickets already certified); never
  //     fails fulfilment — the structured signature is already on the
  //     ticket regardless, and staff can regenerate from the admin view.
  {
    const admin2 = createAdminClient();
    for (const t of tickets) {
      const sig = t.waiver_signature as WaiverSignatureRecord | null;
      if (!sig || sig.certificate_path) continue;
      try {
        const pdf = await renderWaiverCertificate({
          signature: sig,
          eventTitle: order.events.title,
          tierName: t.ticket_types?.name ?? "Ticket",
          ticketCode: t.code,
        });
        const path = `signed/${order.event_id}/${t.id}.pdf`;
        const up = await admin2.storage
          .from("waiver-documents")
          .upload(path, pdf, { contentType: "application/pdf", upsert: true });
        if (up.error) {
          console.error("[fulfillment] waiver cert upload failed:", up.error);
          continue;
        }
        const nextSig: WaiverSignatureRecord = {
          ...sig,
          certificate_path: path,
        };
        await supabase
          .from("tickets")
          .update({ waiver_signature: nextSig })
          .eq("id", t.id);
        t.waiver_signature = nextSig;
      } catch (e) {
        console.error("[fulfillment] waiver cert render threw:", e);
      }
    }
  }

  // 3. Build the ticket list for the email. QR codes are loaded
  //    by the recipient's mail client from /api/tickets/<code>/qr
  //    rather than embedded as data URIs (Gmail / Outlook block
  //    those inconsistently).
  const ticketsForEmail = tickets.map((t) => ({
    code: t.code,
    tierName: t.ticket_types?.name ?? "Ticket",
  }));
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://www.ffsahub.com";

  // 4. Send confirmation email via Resend.
  // sendViaResend doesn't throw — returns { messageId, error } so we
  // just check error and log; tickets are already issued either way.
  if (!isEmailConfigured()) {
    console.warn(
      "[fulfillment] RESEND_API_KEY not set; tickets issued without sending email"
    );
    return { ok: true };
  }
  const brand = resolveEventBrand(order.events);
  // From / reply-to / logo: the event's own email settings (migration 241),
  // else its brand's sender — src/lib/email/event-sender.ts.
  const sender = await resolveEventSender(supabase, order.events, brand);
  const fromEmail = sender.fromEmail;
  const fromName = sender.fromName;
  const replyTo = sender.replyTo;
  const emailArgs = {
    buyerFirstName: order.buyer_first_name,
    eventTitle: order.events.title,
    eventDate: formatEventDate(
      order.events.start_date,
      order.events.end_date
    ),
    eventLocation: order.events.location,
    tickets: ticketsForEmail,
    orderId: orderId,
    totalCents: order.total_cents,
    currency: order.currency ?? "ZAR",
    siteUrl,
    headerLogoUrl: sender.headerLogoUrl,
  };
  // The event's own subject / message for this email (migration 242).
  const wording = wordingFor(order.events.email_wording, "ticket_confirmation", {
    firstName: order.buyer_first_name,
    eventTitle: order.events.title,
    defaultSubject: ticketEmailSubject(brand, order.events.title),
  });
  const subject = wording.subject;

  // Record the send in the email ledger (migration 141) BEFORE we send,
  // so a confirmation email can never again vanish without a trace. The
  // ledger always writes via the service-role client (this path runs
  // both from the PayFast webhook with an admin client and from the
  // admin "resend" route with a user-scoped one). All ledger calls are
  // best-effort and never block the actual send.
  const admin = createAdminClient();
  const ledgerId = await recordEmail(admin, {
    toEmail: order.buyer_email,
    provider: "resend",
    category: "ticket_confirmation",
    subject,
    contactId: order.buyer_contact_id ?? null,
    eventId: order.event_id,
    orderId,
    // Names the event rather than the code path, so this still explains
    // itself on her record long after the order is closed.
    reason: `Her ticket order for ${order.events.title} was paid`,
  });

  const sendResult = await sendViaResend({
    fromEmail,
    fromName,
    replyTo,
    to: order.buyer_email,
    subject,
    html: ticketEmailHtml(brand, { ...emailArgs, message: wording.message }),
    category: "ticket_confirmation",
  });
  if (sendResult.error) {
    console.error(
      "[fulfillment] failed to send confirmation email:",
      sendResult.error
    );
    await markFailed(admin, ledgerId, sendResult.error);
    // Tickets are issued — staff can resend the email from the admin
    // orders view. Don't fail fulfilment for an email-only issue.
  } else {
    await markSent(admin, ledgerId, sendResult.messageId);
  }

  // 5. CRM resolution (async-spirit: never fails fulfilment).
  // Routes the buyer through the existing dedup pipeline, links the
  // contact to the order, creates the event_registration, applies
  // the consent label, writes the timeline entry. Dedup conflicts
  // land in the existing review queue and resolve later.
  try {
    const crm = await resolveOrderToCrm(supabase, orderId);
    if (!crm.ok) {
      console.error(
        "[fulfillment] CRM resolution returned error (non-blocking):",
        crm.error
      );
    }
  } catch (e) {
    console.error("[fulfillment] CRM resolution threw (non-blocking):", e);
  }

  return { ok: true };
}
