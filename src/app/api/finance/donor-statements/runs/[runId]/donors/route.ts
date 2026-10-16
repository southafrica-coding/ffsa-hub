import { NextResponse } from "next/server";
import { authorizeDonorStatements, dsDb } from "@/lib/finance/donor-statements-server";
import { isValidEmail } from "@/lib/finance/donor-statements";

// PATCH { donorKey, email?, displayName?, excluded?, mergeIntoKey?, note? }
//   → finance's fix for one donor in this run. Send null to clear a field.
//
// Edits sit beside the imported lines (never change them), so a fix can be
// undone and a re-read always shows what Xero said plus what finance changed.

type Ctx = { params: Promise<{ runId: string }> };

export async function PATCH(request: Request, context: Ctx) {
  const auth = await authorizeDonorStatements();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { runId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const donorKey = String(body.donorKey ?? "").trim();
  if (!donorKey) return NextResponse.json({ error: "donorKey is required" }, { status: 400 });

  const admin = dsDb();
  const { data: existing } = await admin
    .from("donor_statement_donor_edits")
    .select("*")
    .eq("run_id", runId)
    .eq("donor_key", donorKey)
    .maybeSingle();

  const next: Record<string, unknown> = {
    run_id: runId,
    donor_key: donorKey,
    email: existing?.email ?? null,
    display_name: existing?.display_name ?? null,
    excluded: existing?.excluded ?? false,
    merge_into_key: existing?.merge_into_key ?? null,
    note: existing?.note ?? null,
  };
  const text = (v: unknown) => (v === null || v === undefined ? null : String(v).trim() || null);
  if ("email" in body) {
    const email = text(body.email);
    if (email && !isValidEmail(email)) return NextResponse.json({ error: `“${email}” isn't a valid email` }, { status: 400 });
    next.email = email;
  }
  if ("displayName" in body) next.display_name = text(body.displayName);
  if ("excluded" in body) next.excluded = body.excluded === true;
  if ("note" in body) next.note = text(body.note);
  if ("mergeIntoKey" in body) {
    const into = text(body.mergeIntoKey);
    if (into === donorKey) return NextResponse.json({ error: "Can't merge a donor into themselves" }, { status: 400 });
    next.merge_into_key = into;
  }

  const { error } = await admin
    .from("donor_statement_donor_edits")
    .upsert({ ...next, updated_by: auth.user.id, updated_at: new Date().toISOString() }, { onConflict: "run_id,donor_key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
