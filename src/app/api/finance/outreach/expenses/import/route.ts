import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rowKey, type ImportRow } from "@/lib/finance/outreach-import";

/**
 * Spreadsheet import for outreach expenses — repeatable by construction.
 *
 * The previous importer POSTed one expense per row to the plain create
 * endpoint. outreach_expenses has no natural key, so importing the same
 * sheet twice doubled every figure, and the second run reported the same
 * cheerful "Imported 41 expenses" as the first.
 *
 * Every row now carries a content key (migration 184). Re-importing the
 * same sheet writes nothing and says so. Rows that genuinely changed — a
 * corrected amount, a fixed date — hash differently and arrive as new,
 * which is the honest reading: the sheet no longer says what it said.
 *
 * POST   { team_id, filename?, rows[] }  -> { created, skipped, batchId }
 * DELETE ?batch_id=...                   -> undo one import ("start again")
 *
 * Authorisation is RLS. Every write below goes through the caller's client,
 * and migration 017 restricts these tables to finance.edit, finance_admin,
 * admins and the team's own members.
 */

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // The generated Supabase types predate migration 184, so they know
  // nothing about outreach_expense_imports or the two new columns on
  // outreach_expenses. Same cast the Xero report route uses.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const body = await request.json().catch(() => null);
  const teamId = body?.team_id as string | undefined;
  const filename = (body?.filename as string | undefined) ?? null;
  const rows = body?.rows as ImportRow[] | undefined;

  if (!teamId || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json(
      { error: "team_id and a non-empty rows array are required" },
      { status: 400 }
    );
  }

  const invalid = rows.findIndex(
    (r) => !r?.category_id || !r?.expense_date || r?.zar_amount == null
  );
  if (invalid !== -1) {
    return NextResponse.json(
      { error: `Row ${invalid + 1} is missing a category, a date or an amount` },
      { status: 400 }
    );
  }

  // The batch row exists before any expense points at it, so an undo always
  // has something to delete even if the insert half-fails.
  const { data: batch, error: batchError } = await db
    .from("outreach_expense_imports")
    .insert({
      team_id: teamId,
      filename,
      row_count: rows.length,
      imported_by: user.id,
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    return NextResponse.json(
      { error: batchError?.message ?? "Could not start the import" },
      { status: 403 }
    );
  }

  // Two identical lines inside ONE sheet are a real thing (the same taxi fare
  // twice in a day). They share a key, so the database would keep one and the
  // person would never learn the other vanished. Collapse them here and report
  // them separately from rows that were already in the database.
  const seen = new Set<string>();
  const duplicatedInFile: string[] = [];
  const payload: Record<string, unknown>[] = [];

  for (const r of rows) {
    const key = rowKey(teamId, r);
    if (seen.has(key)) {
      duplicatedInFile.push(r.description || r.vendor || r.expense_date);
      continue;
    }
    seen.add(key);
    payload.push({
      team_id: teamId,
      category_id: r.category_id,
      expense_date: r.expense_date,
      receipt_code: r.receipt_code ?? null,
      vendor: r.vendor ?? null,
      description: r.description || "Imported expense",
      purchaser: r.purchaser ?? null,
      payment_method: "card",
      local_currency: r.local_currency ?? "ZAR",
      local_amount: r.local_amount ?? r.zar_amount,
      exchange_rate: r.exchange_rate ?? 1,
      zar_amount: r.zar_amount,
      notes: r.notes ?? null,
      created_by: user.id,
      import_batch_id: batch.id,
      import_row_key: key,
    });
  }

  // ignoreDuplicates gives INSERT ... ON CONFLICT DO NOTHING. The select
  // returns only rows actually written, so "created" is measured, not assumed.
  const { data: inserted, error: insertError } = await db
    .from("outreach_expenses")
    .upsert(payload, {
      onConflict: "team_id,import_row_key",
      ignoreDuplicates: true,
    })
    .select("id");

  if (insertError) {
    await db.from("outreach_expense_imports").delete().eq("id", batch.id);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const created = (inserted as { id: string }[] | null)?.length ?? 0;
  const skipped = payload.length - created;

  await db
    .from("outreach_expense_imports")
    .update({ created_count: created, skipped_count: skipped })
    .eq("id", batch.id);

  return NextResponse.json({
    success: true,
    batchId: batch.id,
    offered: rows.length,
    created,
    skipped,
    duplicatedInFile,
  });
}

/**
 * Undo one import. Expenses edited since the import go too — they belong to
 * the batch, and "start again" means the sheet's rows leave.
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { searchParams } = new URL(request.url);
  const batchId = searchParams.get("batch_id");

  if (!batchId) {
    return NextResponse.json({ error: "batch_id is required" }, { status: 400 });
  }

  const { data: removed, error } = await db
    .from("outreach_expenses")
    .delete()
    .eq("import_batch_id", batchId)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db.from("outreach_expense_imports").delete().eq("id", batchId);

  const removedCount = (removed as { id: string }[] | null)?.length ?? 0;
  return NextResponse.json({ success: true, removed: removedCount });
}
