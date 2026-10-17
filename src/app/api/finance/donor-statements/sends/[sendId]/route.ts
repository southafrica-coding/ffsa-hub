import { NextResponse } from "next/server";
import { authorizeDonorStatements, dsDb, DONOR_STATEMENTS_BUCKET } from "@/lib/finance/donor-statements-server";

// GET → the PDF exactly as it was sent or posted.

type Ctx = { params: Promise<{ sendId: string }> };

export async function GET(_request: Request, context: Ctx) {
  const auth = await authorizeDonorStatements();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { sendId } = await context.params;
  const admin = dsDb();
  const { data: row } = await admin
    .from("donor_statement_sends")
    .select("pdf_path, file_name")
    .eq("id", sendId)
    .maybeSingle();
  if (!row?.pdf_path) return NextResponse.json({ error: "No saved PDF for this send" }, { status: 404 });
  const { data: blob, error } = await admin.storage.from(DONOR_STATEMENTS_BUCKET).download(row.pdf_path);
  if (error || !blob) return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  return new NextResponse(await blob.arrayBuffer(), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${row.file_name.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
