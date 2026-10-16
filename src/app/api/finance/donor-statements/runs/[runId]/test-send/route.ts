import { NextResponse } from "next/server";
import { authorizeDonorStatements, dsDb, loadDonorStatement, loadStatementImages } from "@/lib/finance/donor-statements-server";
import { renderDonorStatementPdf } from "@/lib/finance/donor-statement-pdf";
import { statementEmail, statementFileName } from "@/lib/finance/donor-statement-wording";
import { isValidEmail } from "@/lib/finance/donor-statements";
import { sendTransactional } from "@/lib/email/send-transactional";

// POST { donor: <key>, to: "someone@…" }
//   → sends that donor's statement email, PDF attached, to `to` instead of
//     the donor. Exactly what the donor would get: same subject, body,
//     attachment, From and Reply-To. Logged in the email ledger as a test.

type Ctx = { params: Promise<{ runId: string }> };

export async function POST(request: Request, context: Ctx) {
  const auth = await authorizeDonorStatements();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { runId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { donor?: string; to?: string };
  const to = String(body.to ?? "").trim();
  if (!isValidEmail(to)) return NextResponse.json({ error: "Enter the address to send the test to" }, { status: 400 });

  const admin = dsDb();
  const loaded = await loadDonorStatement(admin, runId, String(body.donor ?? ""));
  if ("error" in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  const { review, donor, settings } = loaded;
  if (!settings.from_email) {
    return NextResponse.json({ error: "Apply migration 246 so statements have a sender." }, { status: 500 });
  }
  const year = review.run.tax_year;

  const images = await loadStatementImages(admin, settings);
  const pdf = await renderDonorStatementPdf({ settings, donor, year, ...images });
  const email = statementEmail(settings, donor, year);

  const result = await sendTransactional({
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    category: "donor_statement_test",
    fromName: settings.from_name || settings.org_name,
    fromEmail: settings.from_email,
    replyTo: settings.reply_to || null,
    sourceType: "donor_statement_run",
    sourceId: runId,
    reason: `Test of ${donor.name}'s ${year} donor statement`,
    attachments: [{ filename: statementFileName(year, donor.name), content: pdf, contentType: "application/pdf" }],
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true, id: result.id });
}
