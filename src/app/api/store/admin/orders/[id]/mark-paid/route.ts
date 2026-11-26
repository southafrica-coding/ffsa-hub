import { NextResponse } from "next/server";
import { storeAdminClient } from "@/lib/store/db";
import { settleAndNotify } from "@/lib/store/fulfil";
import { getOrder } from "@/services/store";
import { requireStoreStaff } from "../../../_guard";

// POST /api/store/admin/orders/[id]/mark-paid — Media confirms an EFT has
// reflected. Same settle path as the PayFast ITN: grants entitlements,
// makes codes, opens fulfilment, sends emails. Card orders can't be marked
// paid by hand.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireStoreStaff("manage");
  if (!guard.ok) return guard.response;
  const { data: order } = await getOrder(guard.supabase, id);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.payment_method !== "eft") return NextResponse.json({ error: "Card orders are marked paid by PayFast" }, { status: 400 });
  const outcome = await settleAndNotify(storeAdminClient(), { orderId: id, markedPaidBy: guard.userId });
  if (outcome === "error") return NextResponse.json({ error: "Marked paid failed part-way. Check the order." }, { status: 500 });
  return NextResponse.json({ success: true, outcome });
}
