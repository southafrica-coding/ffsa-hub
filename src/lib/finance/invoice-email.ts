import { eventLogoBlock } from "@/lib/email/event-sender";
// ────────────────────────────────────────────────────────────
// FFSA Hub — rendering a school invoice email from a Xero template
// ────────────────────────────────────────────────────────────
// The templates are word-for-word copies of finance's Xero email templates
// (migration 237). This fills Xero's own placeholders the way Xero does, so a
// template can be pasted in from Xero unchanged and the student gets the same
// email Xero would have sent.
//
// Formats are kept in one place (XERO_FORMAT) so they can be matched exactly
// against a real Xero-sent email. Pure: no database, no Xero.
// ────────────────────────────────────────────────────────────

export interface InvoiceEmailTemplate {
  subject: string;
  body: string;
  include_online_action: boolean;
}

export interface InvoiceEmailData {
  contactFirstName: string;
  contactName: string;
  tradingName: string;
  invoiceNumber: string;
  currencyCode: string; // "ZAR"
  invoiceTotal: number;
  amountDue: number;
  dueDate: string; // YYYY-MM-DD
  onlineInvoiceUrl: string | null;
  /** An event's own logo above the message (event invoices, migration 241). */
  headerLogoUrl?: string | null;
}

/** How Xero prints values in emails. One place to adjust against a real email. */
export const XERO_FORMAT = {
  // 15000 → "15,000.00"
  amount: (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  // "2027-03-04" → "4 Mar 2027"
  date: (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }),
};

/** Every placeholder the copied templates use, filled from one invoice. */
export function placeholderValues(d: InvoiceEmailData): Record<string, string> {
  const amt = XERO_FORMAT.amount;
  return {
    "Contact First Name": d.contactFirstName || d.contactName,
    "Contact Name": d.contactName,
    "Trading Name": d.tradingName,
    "Invoice Number": d.invoiceNumber,
    "Currency Code": d.currencyCode,
    "Invoice Total": amt(d.invoiceTotal),
    "Invoice Total Without Currency": amt(d.invoiceTotal),
    "Amount Due": amt(d.amountDue),
    "Amount Due Without Currency": amt(d.amountDue),
    "Due Date": XERO_FORMAT.date(d.dueDate),
    "Online Invoice Link": d.onlineInvoiceUrl ?? "",
  };
}

/**
 * Replace [Placeholder]s. Matching is exact, as in Xero. Anything bracketed
 * that isn't a known placeholder is left untouched and reported, so a typo
 * shows up in the preview instead of silently vanishing.
 */
export function fillPlaceholders(
  text: string,
  values: Record<string, string>
): { text: string; unknown: string[] } {
  const unknown = new Set<string>();
  const out = text.replace(/\[([A-Za-z][A-Za-z ]*[A-Za-z])\]/g, (whole, key: string) => {
    if (key in values) return values[key];
    unknown.add(key);
    return whole;
  });
  return { text: out, unknown: [...unknown] };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text → email-safe HTML: escaped, line breaks kept, links clickable. */
function textToHtml(text: string): string {
  return escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" style="color:#0B6BCB">$1</a>')
    .replace(/\n/g, "<br>");
}

export interface RenderedInvoiceEmail {
  subject: string;
  text: string;
  html: string;
  /** Bracketed words in the template that aren't Xero placeholders. */
  unknownPlaceholders: string[];
}

export function renderInvoiceEmail(
  template: InvoiceEmailTemplate,
  data: InvoiceEmailData
): RenderedInvoiceEmail {
  const values = placeholderValues(data);
  const subject = fillPlaceholders(template.subject, values);
  const body = fillPlaceholders(template.body, values);

  // Xero's "Include action to online invoice and detail summary": a summary
  // of the invoice and a button to it, under the message.
  const action =
    template.include_online_action && data.onlineInvoiceUrl
      ? `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0;border:1px solid #DADCE0;border-radius:4px;width:100%;max-width:420px">
  <tr><td style="padding:16px 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1F2937">
    <div style="font-size:12px;color:#6B7280">Invoice ${escapeHtml(data.invoiceNumber)}</div>
    <div style="font-size:22px;font-weight:bold;margin:4px 0">${escapeHtml(data.currencyCode)} ${escapeHtml(values["Amount Due"])}</div>
    <div style="font-size:13px;color:#6B7280">Due ${escapeHtml(values["Due Date"])}</div>
    <div style="margin-top:14px"><a href="${escapeHtml(data.onlineInvoiceUrl)}" style="display:inline-block;background:#0B6BCB;color:#FFFFFF;text-decoration:none;font-weight:bold;padding:10px 18px;border-radius:4px">View invoice</a></div>
  </td></tr>
</table>`
      : "";

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#FFFFFF">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1F2937;max-width:640px">${data.headerLogoUrl ? eventLogoBlock(data.headerLogoUrl).replace("margin:0 auto;", "margin:0;").replace('align="center"', 'align="left"') : ""}${textToHtml(body.text)}${action}</div>
</body></html>`;

  const text =
    body.text +
    (template.include_online_action && data.onlineInvoiceUrl
      ? `\n\n—\nInvoice ${data.invoiceNumber} · ${data.currencyCode} ${values["Amount Due"]} due ${values["Due Date"]}\nView invoice: ${data.onlineInvoiceUrl}`
      : "");

  return {
    subject: subject.text,
    text,
    html,
    unknownPlaceholders: [...new Set([...subject.unknown, ...body.unknown])],
  };
}
