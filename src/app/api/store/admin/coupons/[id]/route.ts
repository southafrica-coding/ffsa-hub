import { NextResponse } from "next/server";
import { couponWriteError, lockedChange, normaliseCouponInput, type StoreCoupon } from "@/lib/store/coupons";
import { getCoupon, updateCoupon } from "@/services/store";
import { readJson } from "../../../_shared";
import { requireStoreStaff } from "../../_guard";

const UUID = /^[0-9a-f-]{36}$/i;

// PATCH /api/store/admin/coupons/[id] — store.manage.
//   { active: boolean }  turn a code on or off, nothing else changes
//   the whole form       edit it. Once a code has been used, its code,
//                        discount and product stay as they are (the
//                        database enforces this too), and max uses can't
//                        go below the uses so far.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireStoreStaff("manage");
  if (!guard.ok) return guard.response;
  if (!UUID.test(id)) return NextResponse.json({ error: "Coupon not found" }, { status: 404 });

  const body = await readJson(request);
  const { data: existing, error: loadErr } = await getCoupon(guard.supabase, id);
  if (loadErr) return NextResponse.json({ error: "We couldn't load that coupon. Try again." }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
  const before = existing as StoreCoupon;

  let patch: Parameters<typeof updateCoupon>[2];
  const keys = body && typeof body === "object" ? Object.keys(body) : [];
  if (keys.length === 1 && keys[0] === "active") {
    const active = (body as { active: unknown }).active;
    if (typeof active !== "boolean") return NextResponse.json({ error: "Say whether the code is on or off." }, { status: 400 });
    patch = { active };
  } else {
    const input = normaliseCouponInput(body);
    if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
    const locked = lockedChange(before, input.row);
    if (locked) return NextResponse.json({ error: locked }, { status: 409 });
    if (input.row.max_uses != null && input.row.max_uses < before.used_count) {
      return NextResponse.json({ error: `It's been used ${before.used_count} times, so max uses can't be lower than that.` }, { status: 409 });
    }
    patch = input.row;
  }

  const { data, error } = await updateCoupon(guard.supabase, id, patch);
  if (error || !data) {
    if (!error) return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
    const mapped = couponWriteError(error);
    if (mapped.status === 500) console.error("[store/admin/coupons] update failed", error.code ?? "", error.message ?? "");
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
  return NextResponse.json({ success: true, coupon: data });
}
