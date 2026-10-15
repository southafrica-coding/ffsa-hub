import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageFinance } from "@/lib/api-auth";
import { renderInvoiceEmail } from "@/lib/finance/invoice-email";
import { sendViaResend } from "@/lib/email/resend-send";
import { recordEmail, markSent, markFailed } from "@/lib/email/ledger";
import { INVOICE_SENDER, sendSchoolInvoiceEmail, type StoredTemplate } from "@/services/invoice-email-delivery";
import { getXeroTradingName } from "@/services/xero";

// POST { templateId, xeroInvoiceId? } — send this template to YOU.
//   With xeroInvoiceId: exactly what a student would get for that real Xero
//   invoice (its PDF, its online link) — nothing is marked sent in Xero.
//   Without: sample figures, no PDF, so the wording can be checked.
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageFinance(supabase, user.id))) {
    return NextResponse.json({ error: "Finance access required" }, { status: 403 });
  }

  const b = await request.json().catch(() => ({}));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: template } = await admin.from("invoice_email_templates").select("*").eq("id", b.templateId).maybeSingle();
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  const t = template as StoredTemplate;

  if (typeof b.xeroInvoiceId === "string" && b.xeroInvoiceId) {
    const res = await sendSchoolInvoiceEmail(admin, {
      region: t.xero_region,
      invoiceId: b.xeroInvoiceId,
      template: t,
      to: user.email,
      overrideTo: user.email,
      firstName: b.firstName ?? "",
      fullName: b.fullName ?? "",
    });
    return res.ok ? NextResponse.json({ success: true, to: user.email }) : NextResponse.json({ error: res.error }, { status: 400 });
  }

  const tradingName = (await getXeroTradingName(admin, t.xero_region)) ?? "Fire & Fragrance SA NPC";
  const email = renderInvoiceEmail(t, {
    contactFirstName: "Sample",
    contactName: "Sample Student",
    tradingName,
    invoiceNumber: "INV-SAMPLE",
    currencyCode: "ZAR",
    invoiceTotal: 51000,
    amountDue: 45000,
    dueDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    onlineInvoiceUrl: "https://in.xero.com/",
  });
  const ledgerId = await recordEmail(admin, {
    toEmail: user.email,
    provider: "resend",
    category: "school_invoice_test",
    subject: `[TEST] ${email.subject}`,
    sourceType: "invoice_email_template",
    sourceId: t.id,
    reason: `Test of the ${t.name} invoice email (sample figures)`,
  });
  const sent = await sendViaResend({
    fromEmail: INVOICE_SENDER.email,
    fromName: INVOICE_SENDER.name,
    replyTo: INVOICE_SENDER.replyTo,
    to: user.email,
    subject: `[TEST] ${email.subject}`,
    html: email.html,
    text: email.text,
    category: "school_invoice_test",
  });
  if (sent.error) {
    await markFailed(admin, ledgerId, sent.error);
    return NextResponse.json({ error: sent.error }, { status: 400 });
  }
  await markSent(admin, ledgerId, sent.messageId);
  return NextResponse.json({ success: true, to: user.email });
}
