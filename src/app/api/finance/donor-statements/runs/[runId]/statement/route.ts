import { NextResponse } from "next/server";
import { authorizeDonorStatements, dsDb, loadDonorStatement, loadStatementImages } from "@/lib/finance/donor-statements-server";
import { renderDonorStatementPdf } from "@/lib/finance/donor-statement-pdf";
import { statementEmail, statementFileName } from "@/lib/finance/donor-statement-wording";

// GET ?donor=<key>                 → the PDF statement (inline; &download=1 to save)
// GET ?donor=<key>&view=email      → the email as it would be sent: { subject, text, html, … }
//
// Built fresh from the run's lines + edits + settings every time, so a
// preview always matches what a send would produce right now.

type Ctx = { params: Promise<{ runId: string }> };

export async function GET(request: Request, context: Ctx) {
  const auth = await authorizeDonorStatements();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { runId } = await context.params;
  const url = new URL(request.url);
  const key = url.searchParams.get("donor") ?? "";

  const admin = dsDb();
  const loaded = await loadDonorStatement(admin, runId, key);
  if ("error" in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  const { review, donor, settings } = loaded;
  const year = review.run.tax_year;

  if (url.searchParams.get("view") === "email") {
    const email = statementEmail(settings, donor, year);
    return NextResponse.json({
      ...email,
      to: donor.email,
      toValid: donor.emailValid,
      fromName: settings.from_name ?? settings.org_name,
      fromEmail: settings.from_email ?? null,
      replyTo: settings.reply_to ?? null,
      fileName: statementFileName(year, donor.name),
      missingImages: [!settings.logo_path && "logo", !settings.signature_path && "signature"].filter(Boolean),
    });
  }

  const images = await loadStatementImages(admin, settings);
  const pdf = await renderDonorStatementPdf({ settings, donor, year, ...images });
  const fileName = statementFileName(year, donor.name);
  const disposition = url.searchParams.get("download") ? "attachment" : "inline";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${fileName.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
