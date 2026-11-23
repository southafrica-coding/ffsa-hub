// Equipment hire emails (spec rules 9 and 11). Every send goes through
// sendTransactional (suppression check + delivery ledger) and is wrapped so a
// mail failure never breaks the action that triggered it.

import { renderEmailShell, bodyParagraph, emphasis, escapeHtml } from "@/lib/email/shell";
import { sendTransactional } from "@/lib/email/send-transactional";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEquipmentManagerEmails, type EquipmentOrderFull } from "@/services/equipment";
import { rangeLabel } from "./dates";
import { rands } from "./money";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://www.ffsahub.com").replace(
  /\/$/,
  ""
);

export const rentalUrl = (token: string) => `${SITE}/hire/o/${token}`;
export const staffOrderUrl = (id: string) => `${SITE}/bookings/equipment/orders/${id}`;

/** The school or ministry a request is for (381 added schools). */
function forName(order: EquipmentOrderFull): string | null {
  return order.ministry?.name ?? order.school?.name ?? null;
}

function firstName(name: string | null | undefined) {
  return (name ?? "").trim().split(/\s+/)[0] || "there";
}

function linesHtml(order: EquipmentOrderFull, internal = false) {
  const rows = order.lines
    .map((l) => {
      const p = l.product;
      const name = p ? [p.brand, p.model].filter(Boolean).join(" ") || p.name : "Item";
      return `${l.quantity} × ${escapeHtml(name)}${internal ? "" : ` — ${rands(l.line_total_cents)}`}`;
    })
    .join("<br/>");
  return bodyParagraph(rows);
}

function when(order: Pick<EquipmentOrderFull, "starts_on" | "ends_on" | "collect_time" | "return_time">) {
  const range = rangeLabel(order.starts_on, order.ends_on);
  const times = [
    order.collect_time && `collect ${order.collect_time.slice(0, 5)}`,
    order.return_time && `back by ${order.return_time.slice(0, 5)}`,
  ]
    .filter(Boolean)
    .join(", ");
  return times ? `${range} (${times})` : range;
}

async function send(to: string, subject: string, html: string, category: string, orderId: string, reason: string) {
  try {
    await sendTransactional({ to, subject, html, category, sourceType: "equipment_order", sourceId: orderId, reason });
  } catch (e) {
    console.error(`[equipment/emails] ${category} to ${to} failed:`, e instanceof Error ? e.message : e);
  }
}

async function toManagers(subject: string, html: string, category: string, orderId: string, reason: string) {
  try {
    const emails = await getEquipmentManagerEmails(createAdminClient());
    if (emails.length === 0) {
      console.warn(`[equipment/emails] nobody holds equipment.manage; "${subject}" went to no one`);
      return;
    }
    await Promise.all(emails.map((e) => send(e, subject, html, category, orderId, reason)));
  } catch (e) {
    console.error("[equipment/emails] manager lookup failed:", e instanceof Error ? e.message : e);
  }
}

/** Paid and confirmed: amount, reference and the no-login rental link. */
export async function sendOrderConfirmed(order: EquipmentOrderFull, xeroInvoiceNumber: string | null) {
  const html = renderEmailShell({
    title: `Your hire ${order.number} is booked`,
    preheader: `Booked for ${rangeLabel(order.starts_on, order.ends_on)}.`,
    eyebrow: "Hire booked",
    heading: "You're booked",
    bodyHtml: `
      ${bodyParagraph(`Hi ${escapeHtml(firstName(order.customer_name))}, your payment came through and your gear is booked for ${escapeHtml(when(order))}.`)}
      ${linesHtml(order)}
      ${bodyParagraph(`${emphasis("Paid")} ${rands(order.total_cents)} hire (incl. VAT) and ${rands(order.deposit_cents)} refundable deposit. Your reference is ${emphasis(escapeHtml(order.number))}.`)}
      ${xeroInvoiceNumber ? bodyParagraph(`Your invoice (${escapeHtml(xeroInvoiceNumber)}) comes separately from our accounts system.`) : ""}
      ${bodyParagraph("Bring the ID you gave at checkout when you collect. We check the gear with you, take photos, and you sign for it.")}
    `,
    cta: { label: "See your rental", url: rentalUrl(order.access_token) },
    siteUrl: SITE,
  });
  await send(order.customer_email, `Your hire ${order.number} is booked`, html, "equipment_order_confirmed", order.id, "Paid for an equipment hire");
}

/** A ministry request: an acknowledgement to the asker, an alert to the managers. */
export async function sendRequestReceived(order: EquipmentOrderFull) {
  const ask = renderEmailShell({
    title: `Request ${order.number} sent`,
    preheader: "Waiting on the rental manager.",
    eyebrow: "Request sent",
    heading: "Waiting on the rental manager",
    bodyHtml: `
      ${bodyParagraph(`Hi ${escapeHtml(firstName(order.customer_name))}, your request${order.purpose ? ` for ${emphasis(escapeHtml(order.purpose))}` : ""} on ${escapeHtml(when(order))} has gone to the rental manager.`)}
      ${linesHtml(order, true)}
      ${bodyParagraph("The gear is held for you until it's approved or declined. You'll get an email either way.")}
    `,
    cta: { label: "See your request", url: rentalUrl(order.access_token) },
    siteUrl: SITE,
  });
  await send(order.customer_email, `Request ${order.number} sent`, ask, "equipment_request_received", order.id, "Asked to hire equipment for a ministry");

  const alert = renderEmailShell({
    title: `New equipment request ${order.number}`,
    preheader: `${order.customer_name}${forName(order) ? `, ${forName(order)}` : ""}`,
    eyebrow: "Needs your approval",
    heading: order.purpose ?? "A ministry equipment request",
    bodyHtml: `
      ${bodyParagraph(`${emphasis(escapeHtml(order.customer_name))}${forName(order) ? ` for ${escapeHtml(forName(order)!)}` : ""} asked for gear on ${escapeHtml(when(order))}.`)}
      ${linesHtml(order, true)}
      ${bodyParagraph("It's held until you approve or decline it.")}
    `,
    cta: { label: "Review the request", url: staffOrderUrl(order.id) },
    siteUrl: SITE,
  });
  await toManagers(`Equipment request ${order.number} needs your approval`, alert, "equipment_request_alert", order.id, "Rental manager for equipment hire");
}

export async function sendRequestDecision(order: EquipmentOrderFull, approved: boolean, reason: string | null) {
  const html = renderEmailShell({
    title: approved ? `Request ${order.number} approved` : `Request ${order.number} declined`,
    preheader: approved ? "Your equipment request is approved." : "An update on your equipment request.",
    eyebrow: approved ? "Request approved" : "Request declined",
    heading: approved ? "You're approved" : "Not this time",
    bodyHtml: approved
      ? `
        ${bodyParagraph(`Hi ${escapeHtml(firstName(order.customer_name))}, your request${order.purpose ? ` for ${emphasis(escapeHtml(order.purpose))}` : ""} on ${escapeHtml(when(order))} is approved.`)}
        ${linesHtml(order, true)}
        ${reason ? bodyParagraph(`${emphasis("Note:")} ${escapeHtml(reason)}`) : ""}
        ${bodyParagraph("Collect from the base at the time on the request. Any damage is charged to your wing.")}
      `
      : `
        ${bodyParagraph(`Hi ${escapeHtml(firstName(order.customer_name))}, your request${order.purpose ? ` for ${emphasis(escapeHtml(order.purpose))}` : ""} on ${escapeHtml(when(order))} wasn't approved.`)}
        ${reason ? bodyParagraph(`${emphasis("Why:")} ${escapeHtml(reason)}`) : ""}
        ${bodyParagraph("The gear has been released. Reply to this email if you'd like to try other dates.")}
      `,
    cta: { label: "See your request", url: rentalUrl(order.access_token) },
    siteUrl: SITE,
  });
  await send(
    order.customer_email,
    approved ? `Request ${order.number} approved` : `Request ${order.number} declined`,
    html,
    approved ? "equipment_request_approved" : "equipment_request_declined",
    order.id,
    "Asked to hire equipment for a ministry"
  );
}

/** "Report an issue" and "Extend" from the rental page both land with the managers. */
export async function sendManagerNote(order: EquipmentOrderFull, kind: "issue" | "extend", text: string) {
  const html = renderEmailShell({
    title: `${kind === "issue" ? "Issue reported" : "Extension asked for"} on ${order.number}`,
    preheader: text.slice(0, 120),
    eyebrow: kind === "issue" ? "Issue reported" : "Extension asked for",
    heading: `${order.number} · ${order.customer_name}`,
    bodyHtml: `
      ${bodyParagraph(escapeHtml(text).replace(/\n/g, "<br/>"))}
      ${bodyParagraph(`Hire: ${escapeHtml(when(order))}. Contact: ${escapeHtml(order.customer_email)}${order.customer_phone ? `, ${escapeHtml(order.customer_phone)}` : ""}.`)}
    `,
    cta: { label: "Open the order", url: staffOrderUrl(order.id) },
    siteUrl: SITE,
  });
  await toManagers(
    `${kind === "issue" ? "Issue reported" : "Extension asked for"} on ${order.number}`,
    html,
    kind === "issue" ? "equipment_issue_report" : "equipment_extension_request",
    order.id,
    "Rental manager for equipment hire"
  );
}
