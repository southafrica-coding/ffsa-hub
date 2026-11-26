import { NextResponse } from "next/server";
import { cancelPendingOrder } from "@/services/store";
import { requireStoreStaff } from "../../../_guard";

// POST /api/store/admin/orders/[id]/cancel — cancel an unpaid order.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireStoreStaff("manage");
  if (!guard.ok) return guard.response;
  const { data, error } = await cancelPendingOrder(guard.supabase, id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Only unpaid orders can be cancelled" }, { status: 409 });
  return NextResponse.json({ success: true });
}
