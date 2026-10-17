import { NextResponse } from "next/server";
import { authorizeDonorStatements, dsDb, loadSends } from "@/lib/finance/donor-statements-server";

// GET → every statement sent or posted for this run's tax year, newest first.
// Across runs on purpose: a donor sent from an earlier import still counts.

type Ctx = { params: Promise<{ runId: string }> };

export async function GET(_request: Request, context: Ctx) {
  const auth = await authorizeDonorStatements();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { runId } = await context.params;
  const admin = dsDb();
  const { data: run } = await admin.from("donor_statement_runs").select("tax_year").eq("id", runId).maybeSingle();
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  try {
    return NextResponse.json({ sends: await loadSends(admin, run.tax_year) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Load failed" }, { status: 500 });
  }
}
