import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance, hasAnyRole } from "@/lib/api-auth";
import {
  recordPayment,
  updatePayment,
  deletePayment,
} from "@/services/school-fees";

// Recording, editing and deleting student payments. Mirrors the RLS on
// student_payments (migration 009) so a caller RLS would refuse gets a clear
// 403 here rather than a database error: insert / update for admins and
// finance_admin (canManageFinance), delete for admins only. RLS stays the
// final word either way.
const PAYMENT_DELETE_ROLES = ["super_admin", "admin"];

const forbidden = () =>
  NextResponse.json(
    { error: "You don't have permission to manage school-fee payments" },
    { status: 403 }
  );

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await canManageFinance(supabase, user.id))) return forbidden();

  const body = await request.json();
  const { student_fee_id, amount_zar, payment_method } = body;

  if (!student_fee_id || !amount_zar || !payment_method) {
    return NextResponse.json(
      { error: "student_fee_id, amount_zar, and payment_method are required" },
      { status: 400 }
    );
  }

  const { data, error } = await recordPayment(supabase, {
    student_fee_id,
    payment_date: body.payment_date || new Date().toISOString().slice(0, 10),
    amount_zar: Number(amount_zar),
    payment_method,
    reference: body.reference ?? null,
    currency_paid: body.currency_paid ?? null,
    currency_amount: body.currency_amount ? Number(body.currency_amount) : null,
    exchange_rate: body.exchange_rate ? Number(body.exchange_rate) : null,
    receipt_path: body.receipt_path ?? null,
    recorded_by: user.id,
    notes: body.notes ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

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
  if (!(await canManageFinance(supabase, user.id))) return forbidden();

  const body = await request.json();
  const { id, ...updateData } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { data, error } = await updatePayment(supabase, id, updateData);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

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
  if (!(await hasAnyRole(supabase, user.id, PAYMENT_DELETE_ROLES))) {
    return forbidden();
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { error } = await deletePayment(supabase, id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
