import { NextResponse } from "next/server";
import { cancelPendingOrder } from "@/services/store";
import { requireStoreStaff } from "../../../_guard";

// POST /api/store/admin/orders/[id]/cancel — cancel an unpaid order. If it
// used a coupon, the database gives the use back (413 trigger).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireStoreStaff("manage");
  if (!guard.ok) return guard.response;
  const { data, error } = await cancelPendingOrder(guard.supabase, id);
  if (error) {
    console.error("[store/admin/cancel]", id, error.code ?? "", error.message ?? "");
    return NextResponse.json({ error: "We couldn't cancel the order. Try again." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Only unpaid orders can be cancelled" }, { status: 409 });
  return NextResponse.json({ success: true });
}
