import { NextResponse } from "next/server";
import { couponWriteError, normaliseCouponInput } from "@/lib/store/coupons";
import { createCoupon, listCoupons } from "@/services/store";
import { readJson } from "../../_shared";
import { requireStoreStaff } from "../_guard";

// GET /api/store/admin/coupons — every coupon, newest first. store.manage.
export async function GET() {
  const guard = await requireStoreStaff("manage");
  if (!guard.ok) return guard.response;
  const { data, error } = await listCoupons(guard.supabase);
  if (error) return NextResponse.json({ error: "We couldn't load the coupons. Try again." }, { status: 500 });
  return NextResponse.json({ coupons: data ?? [] });
}

// POST /api/store/admin/coupons — make a code. store.manage. Runs as the
// staff member (RLS + column grants), so created_by and the audit row are
// stamped with their id by the database.
export async function POST(request: Request) {
  const guard = await requireStoreStaff("manage");
  if (!guard.ok) return guard.response;
  const input = normaliseCouponInput(await readJson(request));
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
  const { data, error } = await createCoupon(guard.supabase, input.row);
  if (error || !data) {
    const mapped = couponWriteError(error);
    if (mapped.status === 500) console.error("[store/admin/coupons] create failed", error?.code ?? "", error?.message ?? "");
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
  return NextResponse.json({ success: true, coupon: data });
}
