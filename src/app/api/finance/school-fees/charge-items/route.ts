import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  upsertChargeItem,
  deleteChargeItem,
  type ChargeItemInput,
} from "@/services/school-billing";

const VALID_TYPES = [
  "deposit",
  "monthly_tuition",
  "outreach",
  "quarter_first",
  "quarter_final",
];

async function upsert(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json()) as ChargeItemInput;
  const { program_id, tier, charge_type, label } = body;

  if (!program_id || !tier || !charge_type) {
    return NextResponse.json(
      { error: "program_id, tier and charge_type are required" },
      { status: 400 }
    );
  }
  if (!VALID_TYPES.includes(charge_type)) {
    return NextResponse.json(
      { error: `Invalid charge_type: ${charge_type}` },
      { status: 400 }
    );
  }

  const { data, error } = await upsertChargeItem(supabase, {
    program_id,
    tier,
    charge_type,
    label: label ?? charge_type,
    amount_zar: body.amount_zar ?? 0,
    xero_item_code: body.xero_item_code ?? null,
    cadence: body.cadence ?? "once",
    quantity: body.quantity ?? 1,
    due_anchor: body.due_anchor ?? "month_day",
    due_day: body.due_day ?? null,
    first_due_month: body.first_due_month ?? null,
    first_due_year: body.first_due_year ?? null,
    fixed_due_date: body.fixed_due_date ?? null,
    arrival_offset_days: body.arrival_offset_days ?? null,
    generation_rule: body.generation_rule ?? "preceding_month_15th",
    generation_fixed_date: body.generation_fixed_date ?? null,
    generation_lead_days: body.generation_lead_days ?? null,
    sort_order: body.sort_order ?? 0,
    active: body.active ?? true,
    notes: body.notes ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, data });
}

export async function POST(request: Request) {
  return upsert(request);
}

export async function PUT(request: Request) {
  return upsert(request);
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

  const { error } = await deleteChargeItem(supabase, id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
