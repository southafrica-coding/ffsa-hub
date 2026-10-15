// ────────────────────────────────────────────────────────────
// FFSA Hub — emailing a school invoice from the school's Xero template
// ────────────────────────────────────────────────────────────
// Xero's API can't pick an email template, so the Hub sends school invoices
// itself (migration 237): the school's template for that organisation, filled
// as Xero would, the Xero PDF attached, from the same sender finance uses in
// Xero ("Finance office", replies to finance@ffsouthafrica.com), logged in the
// email ledger, and the invoice marked sent in Xero.
// ────────────────────────────────────────────────────────────

import { sendViaResend } from "@/lib/email/resend-send";
import { recordEmail, markSent, markFailed, markDropped } from "@/lib/email/ledger";
import { renderInvoiceEmail, type InvoiceEmailTemplate } from "@/lib/finance/invoice-email";
import {
  getXeroInvoiceForEmail,
  getXeroTradingName,
  markXeroInvoiceSent,
  type XeroRegion,
} from "@/services/xero";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/** The sender both Xero organisations use today (Settings → Email settings). */
export const INVOICE_SENDER = {
  name: process.env.INVOICE_FROM_NAME || "Finance office",
  email: process.env.INVOICE_FROM_EMAIL || "finance@ffsouthafrica.com",
  replyTo: process.env.INVOICE_REPLY_TO || "finance@ffsouthafrica.com",
};

export interface StoredTemplate extends InvoiceEmailTemplate {
  id: string;
  name: string;
  xero_region: XeroRegion;
  is_default: boolean;
}

/**
 * The template a school uses in one organisation: its own, else that
 * organisation's default ("Basic") — exactly what Xero would have sent.
 */
export function chooseTemplate(
  templates: StoredTemplate[],
  region: XeroRegion,
  schoolTemplateId: string | null | undefined
): StoredTemplate | null {
  const own = schoolTemplateId ? templates.find((t) => t.id === schoolTemplateId && t.xero_region === region) : null;
  return own ?? templates.find((t) => t.xero_region === region && t.is_default) ?? null;
}

const tradingNameCache = new Map<XeroRegion, Promise<string | null>>();

export async function sendSchoolInvoiceEmail(
  supabase: Client,
  opts: {
    region: XeroRegion;
    invoiceId: string;
    template: StoredTemplate;
    to: string;
    firstName: string;
    fullName: string;
    /** Send to someone else (a test) instead of the student. */
    overrideTo?: string;
    /** Ledger labels; default to school fees. Event ticket invoices pass their own. */
    ledger?: { category: string; reason: string };
    /**
     * Send as someone other than "Finance office" — an event invoice comes
     * from the event's sender (migration 241). Replies still go to finance
     * unless replyTo is given.
     */
    sender?: { name: string; email: string; replyTo?: string | null };
    /** An event's own logo above the message. */
    headerLogoUrl?: string | null;
  }
): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string }> {
  const inv = await getXeroInvoiceForEmail(supabase, opts.region, opts.invoiceId);
  if (!inv.ok) return inv;
  if (opts.template.include_online_action && !inv.onlineUrl) {
    return { ok: false, error: "Xero gave no online invoice link (is the invoice approved?)" };
  }

  if (!tradingNameCache.has(opts.region)) tradingNameCache.set(opts.region, getXeroTradingName(supabase, opts.region));
  const tradingName =
    (await tradingNameCache.get(opts.region)) ?? (opts.region === "us" ? "FF SA USA, Inc" : "Fire & Fragrance SA NPC");

  const email = renderInvoiceEmail(opts.template, {
    contactFirstName: opts.firstName,
    contactName: opts.fullName || inv.contactName,
    tradingName,
    invoiceNumber: inv.invoiceNumber,
    currencyCode: inv.currencyCode,
    invoiceTotal: inv.total,
    amountDue: inv.amountDue,
    dueDate: inv.dueDate,
    onlineInvoiceUrl: inv.onlineUrl,
    headerLogoUrl: opts.headerLogoUrl ?? null,
  });
  if (email.unknownPlaceholders.length) {
    return { ok: false, error: `Template "${opts.template.name}" has unknown placeholders: ${email.unknownPlaceholders.join(", ")}` };
  }

  const to = (opts.overrideTo ?? opts.to).trim();
  const isTest = !!opts.overrideTo;
  const ledgerFields = {
    toEmail: to,
    provider: "resend" as const,
    category: isTest ? "school_invoice_test" : (opts.ledger?.category ?? "school_invoice"),
    subject: email.subject,
    sourceType: "xero_invoice",
    sourceId: opts.invoiceId,
    reason: isTest
      ? `Test of the ${opts.template.name} invoice email`
      : (opts.ledger?.reason ?? `School fees invoice ${inv.invoiceNumber} (${opts.template.name} template)`),
  };

  const { data: supp } = await supabase
    .from("email_suppressions")
    .select("reason")
    .eq("email_normalized", to.toLowerCase())
    .maybeSingle();
  if (supp) {
    const id = await recordEmail(supabase, ledgerFields);
    await markDropped(supabase, id, `suppressed: ${supp.reason}`);
    return { ok: false, error: `${to} is on the suppression list (${supp.reason})` };
  }

  const ledgerId = await recordEmail(supabase, ledgerFields);
  const sent = await sendViaResend({
    fromEmail: opts.sender?.email || INVOICE_SENDER.email,
    fromName: opts.sender?.name || INVOICE_SENDER.name,
    replyTo: opts.sender?.replyTo || INVOICE_SENDER.replyTo,
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    category: `${opts.ledger?.category ?? "school_invoice"}:${inv.invoiceNumber}`,
    attachments: [
      { filename: `Invoice ${inv.invoiceNumber}.pdf`, contentBase64: inv.pdfBase64, type: "application/pdf" },
    ],
  });
  if (sent.error) {
    await markFailed(supabase, ledgerId, sent.error);
    return { ok: false, error: sent.error };
  }
  await markSent(supabase, ledgerId, sent.messageId);

  // Xero shows it as sent, as if finance had emailed it from Xero. A test
  // send doesn't count.
  if (!isTest) await markXeroInvoiceSent(supabase, opts.region, opts.invoiceId);
  return { ok: true, messageId: sent.messageId };
}
