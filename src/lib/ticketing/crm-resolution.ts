// FFSA Hub — Ticket buyer → CRM contact resolution.
//
// After fulfilment, route the order's buyer through the existing
// CRM dedup pipeline:
//
//   1. upsertContactWithDedup → created | matched | queued_for_review.
//   2. If resolved:
//      - link orders.buyer_contact_id, set contact_resolution = 'resolved'.
//      - upsert event_registrations (UNIQUE(contact_id,event_id) prevents
//        a duplicate row if the buyer had a prior free RSVP).
//      - apply the event's base_label_id to every buyer (handled
//        inside upsertContactWithDedup via labelId). The label is a
//        CRM audience marker, not an email-consent record — consent
//        lives in the contact consent/opt-out tables.
//      - write a ticket_purchased activity_event.
//   3. If queued for review: set contact_resolution = 'review_queued'
//      and leave it for staff. The order + tickets are unaffected;
//      the buyer is in the dedup_review_queue and resolves later.
//
// Idempotent — short-circuits when contact_resolution is already
// 'resolved'. Designed to be called from fulfilment but also
// re-runnable from an admin "resolve now" action later.

import { upsertContactWithDedup } from "@/services/contact-upsert";
import { logActivity } from "@/services/activity-events";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export async function resolveOrderToCrm(
  supabase: Client,
  orderId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  // 1. Load order + event (need base_label_id for the consent label).
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select(
      "id, status, contact_resolution, buyer_contact_id, buyer_first_name, buyer_last_name, buyer_email, buyer_phone, marketing_consent, event_id, events(id, base_label_id, public_slug)"
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
  if (order.contact_resolution === "resolved") {
    return { ok: true }; // already done
  }

  // 2. Run the existing dedup/upsert. Every buyer gets the event's
  //    base label, the same as anyone who submits the event form —
  //    marketing_consent still governs email sending, not membership
  //    of the event's audience.
  const eventLabelId = order.events?.base_label_id ?? null;
  const slugForSource =
    order.events?.public_slug ?? order.event_id;

  const upsert = await upsertContactWithDedup(supabase, {
    contact: {
      first_name: order.buyer_first_name,
      last_name: order.buyer_last_name,
      email: order.buyer_email,
      phone: order.buyer_phone,
    },
    labelId: eventLabelId,
    addedVia: `ticket:${orderId}`,
    userId: null,
    source: `ticket:${slugForSource}`,
    // Use 'manual' source-type — staff can look up the order via
    // the source_id (which is our orderId) in the review queue UI.
    reviewSource: { type: "manual", id: orderId },
  });

  if (upsert.error) {
    return { ok: false, error: String(upsert.error) };
  }
  if (!upsert.data) {
    return { ok: false, error: "Dedup returned no outcome" };
  }

  // 3. Conflict → review queue, leave the order in 'review_queued'.
  if (upsert.data.action === "queued_for_review") {
    await supabase
      .from("orders")
      .update({ contact_resolution: "review_queued" })
      .eq("id", orderId);
    return { ok: true };
  }

  // 4. Clean resolution (created or matched).
  const contactId = upsert.data.contactId;

  await supabase
    .from("orders")
    .update({
      buyer_contact_id: contactId,
      contact_resolution: "resolved",
    })
    .eq("id", orderId);

  // 5. event_registration — UNIQUE(contact_id, event_id) means a
  //    prior free RSVP gets its order_id filled in rather than
  //    failing the insert.
  await supabase
    .from("event_registrations")
    .upsert(
      {
        contact_id: contactId,
        event_id: order.event_id,
        status: "confirmed",
        order_id: orderId,
      },
      { onConflict: "contact_id,event_id" }
    );

  // 6. Timeline entry on the buyer's contact.
  await logActivity(supabase, {
    contact_id: contactId,
    event_type: "ticket_purchased",
    payload: { order_id: orderId, event_id: order.event_id },
  });

  return { ok: true };
}
