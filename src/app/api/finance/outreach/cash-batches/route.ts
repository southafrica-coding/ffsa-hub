import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createCashBatch,
  updateCashBatch,
  deleteCashBatch,
} from "@/services/outreach-finance";
import { checkCashAlert } from "@/lib/outreach/cash-alerts";
import { KNOWN_CURRENCY_CODES } from "@/lib/currencies";

/**
 * A cash pull is three numbers (migration 263): cash received, rand that
 * left the account, and the part of that the bank showed as a fee. The
 * rate is worked out in the database, never taken from the form.
 */
function pullFields(body: Record<string, unknown>): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  const zar = Number(body.zar_withdrawn);
  const fee = body.bank_fee == null || body.bank_fee === "" ? 0 : Number(body.bank_fee);
  const local = Number(body.local_currency_received);
  const currency = String(body.local_currency ?? "").trim().toUpperCase();
  if (!body.batch_date) return { ok: false, error: "The date is required" };
  if (!KNOWN_CURRENCY_CODES.has(currency)) return { ok: false, error: "Pick the currency of the cash" };
  if (!(local > 0)) return { ok: false, error: "Enter how much cash you got" };
  if (!(zar > 0)) return { ok: false, error: "Enter the rand that left the account" };
  if (!(fee >= 0) || fee >= zar) return { ok: false, error: "The bank fee must be less than the rand that left the account" };
  return {
    ok: true,
    fields: {
      batch_date: body.batch_date,
      zar_withdrawn: zar,
      bank_fee: fee,
      local_currency: currency,
      local_currency_received: local,
      exchange_rate: 0, // worked out by the database
      notes: body.notes ?? null,
      // The bank screenshot, uploaded under the team's own folder.
      ...(typeof body.proof_path === "string" && body.team_id && body.proof_path.startsWith(`${body.team_id}/pulls/`)
        ? { proof_path: body.proof_path }
        : {}),
    },
  };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();

  if (!body.team_id) {
    return NextResponse.json({ error: "team_id is required" }, { status: 400 });
  }
  const parsed = pullFields(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data, error } = await createCashBatch(supabase, {
    team_id: body.team_id,
    ...parsed.fields,
    created_by: user.id,
  } as Parameters<typeof createCashBatch>[1]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // A bank fee is spending (its own expense), so money in hand moved.
  await checkCashAlert(body.team_id);

  return NextResponse.json({ success: true, data });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const parsed = pullFields(updates);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data, error } = await updateCashBatch(supabase, id, parsed.fields);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (data?.team_id) await checkCashAlert(data.team_id);

  return NextResponse.json({ success: true, data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { data, error } = await deleteCashBatch(supabase, id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data?.length) {
    return NextResponse.json({ error: "You can't delete this cash pull" }, { status: 403 });
  }
  await checkCashAlert(data[0].team_id);

  return NextResponse.json({ success: true });
}
