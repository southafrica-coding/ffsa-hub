import { NextResponse } from "next/server";
import { authorizeDonorStatements, dsDb, loadRunReview } from "@/lib/finance/donor-statements-server";
import type { RunOptions } from "@/lib/finance/donor-statements";

// GET                         → the review (donors, totals, set-aside lines)
// PATCH { options: {...} }    → change the run's choices (gross/net, ZAR, credit notes)
// DELETE                      → archive the run (kept, hidden from the list)

type Ctx = { params: Promise<{ runId: string }> };

export async function GET(_request: Request, context: Ctx) {
  const auth = await authorizeDonorStatements();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { runId } = await context.params;
  try {
    const review = await loadRunReview(dsDb(), runId);
    if (!review) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    return NextResponse.json(review);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Load failed" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: Ctx) {
  const auth = await authorizeDonorStatements();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { runId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { options?: Partial<RunOptions> };
  const o = body.options ?? {};
  const options: Partial<RunOptions> = {};
  if (o.amountBasis === "gross" || o.amountBasis === "net") options.amountBasis = o.amountBasis;
  if (typeof o.includeNonUsd === "boolean") options.includeNonUsd = o.includeNonUsd;
  if (o.creditNotes === "exclude" || o.creditNotes === "net") options.creditNotes = o.creditNotes;

  const admin = dsDb();
  const { data: run } = await admin.from("donor_statement_runs").select("options").eq("id", runId).maybeSingle();
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const { error } = await admin
    .from("donor_statement_runs")
    .update({ options: { ...(run.options ?? {}), ...options }, updated_at: new Date().toISOString() })
    .eq("id", runId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: Ctx) {
  const auth = await authorizeDonorStatements();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { runId } = await context.params;
  const { error } = await dsDb()
    .from("donor_statement_runs")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", runId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
