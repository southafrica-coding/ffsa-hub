import { NextResponse } from "next/server";
import { authorizeDonorStatements, dsDb } from "@/lib/finance/donor-statements-server";
import { DEFAULT_RUN_OPTIONS, donorKey, parseAmount, type SourceLine } from "@/lib/finance/donor-statements";
import { listXeroDonationLines } from "@/services/xero";

// GET                                                     → runs, newest first
// POST { taxYear, source: "xero" }                        → pull from US Xero
// POST { taxYear, source: "upload", fileName, lines, contactEmails } → from a spreadsheet
//
// A run keeps the raw invoice lines (migration 245); the review is worked
// out from them on every read, so changing an option or a rule never needs
// a re-import.

const MAX_LINES = 20000;

export async function GET() {
  const auth = await authorizeDonorStatements();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { data, error } = await dsDb()
    .from("donor_statement_runs")
    .select("id, tax_year, source, source_file_name, status, imported_at, created_at")
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ runs: data ?? [] });
}

function cleanLine(raw: Record<string, unknown>): SourceLine | null {
  const invoiceNumber = String(raw.invoiceNumber ?? "").trim();
  const contactName = String(raw.contactName ?? "").trim();
  const unit = parseAmount(raw.unitPriceUsd);
  const qty = parseAmount(raw.quantity ?? 1);
  if (!invoiceNumber || unit === null || qty === null) return null;
  const date = String(raw.invoiceDate ?? "");
  const total = raw.invoiceTotalUsd === null || raw.invoiceTotalUsd === undefined ? null : parseAmount(raw.invoiceTotalUsd);
  const str = (v: unknown) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
  return {
    invoiceNumber,
    invoiceDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    contactName,
    email: str(raw.email),
    itemCode: str(raw.itemCode),
    description: str(raw.description),
    accountCode: str(raw.accountCode),
    quantity: qty,
    unitPriceUsd: unit,
    invoiceTotalUsd: total,
    currency: str(raw.currency)?.toUpperCase() ?? "USD",
    status: str(raw.status)?.toUpperCase() ?? "PAID",
  };
}

export async function POST(request: Request) {
  const auth = await authorizeDonorStatements();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const taxYear = Number(body.taxYear);
  if (!Number.isInteger(taxYear) || taxYear < 2020 || taxYear > 2100) {
    return NextResponse.json({ error: "Choose a tax year" }, { status: 400 });
  }
  const admin = dsDb();

  let lines: SourceLine[] = [];
  let contactEmails: Record<string, string> = {};
  let fileName: string | null = null;

  if (body.source === "xero") {
    const pulled = await listXeroDonationLines(admin, taxYear);
    if (pulled.error) return NextResponse.json({ error: pulled.error }, { status: 502 });
    lines = pulled.lines;
    for (const l of pulled.lines) {
      const email = l.contactId ? pulled.contactEmails.get(l.contactId) : undefined;
      if (email) contactEmails[donorKey(l.contactName)] = email;
    }
  } else if (body.source === "upload") {
    const raw = Array.isArray(body.lines) ? (body.lines as Record<string, unknown>[]) : [];
    if (raw.length === 0) return NextResponse.json({ error: "The file had no donation rows" }, { status: 400 });
    if (raw.length > MAX_LINES) return NextResponse.json({ error: `Over ${MAX_LINES} rows — is this the right file?` }, { status: 400 });
    lines = raw.map(cleanLine).filter((l): l is SourceLine => l !== null);
    const ce = body.contactEmails && typeof body.contactEmails === "object" ? (body.contactEmails as Record<string, unknown>) : {};
    contactEmails = Object.fromEntries(
      Object.entries(ce).filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => [k, String(v).trim()])
    );
    fileName = String(body.fileName ?? "").slice(0, 200) || null;
  } else {
    return NextResponse.json({ error: "Source must be xero or upload" }, { status: 400 });
  }

  if (lines.length === 0) {
    return NextResponse.json({ error: `No invoice lines found for ${taxYear}.` }, { status: 400 });
  }

  const { data: run, error } = await admin
    .from("donor_statement_runs")
    .insert({
      tax_year: taxYear,
      source: body.source,
      source_file_name: fileName,
      options: DEFAULT_RUN_OPTIONS,
      contact_emails: contactEmails,
      created_by: auth.user.id,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = lines.map((l, i) => ({
    run_id: run.id,
    position: i,
    invoice_number: l.invoiceNumber,
    invoice_date: l.invoiceDate,
    contact_name: l.contactName,
    contact_id: l.contactId ?? null,
    email: l.email ?? null,
    item_code: l.itemCode ?? null,
    description: l.description ?? null,
    account_code: l.accountCode ?? null,
    quantity: l.quantity,
    unit_price_usd: l.unitPriceUsd,
    invoice_total_usd: l.invoiceTotalUsd ?? null,
    currency: l.currency,
    status: l.status,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: insErr } = await admin.from("donor_statement_lines").insert(rows.slice(i, i + 500));
    if (insErr) {
      await admin.from("donor_statement_runs").delete().eq("id", run.id);
      return NextResponse.json({ error: `Saving lines failed: ${insErr.message}` }, { status: 500 });
    }
  }
  return NextResponse.json({ runId: run.id, lineCount: rows.length });
}
