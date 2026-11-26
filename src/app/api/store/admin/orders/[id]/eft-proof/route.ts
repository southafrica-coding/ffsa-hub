import { NextResponse } from "next/server";
import { storeAdminClient } from "@/lib/store/db";
import { getOrder } from "@/services/store";
import { requireStoreStaff } from "../../../_guard";

// GET — open the buyer's proof of payment (60-second signed URL).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireStoreStaff("view");
  if (!guard.ok) return guard.response;
  const { data: order } = await getOrder(guard.supabase, id);
  if (!order?.eft_proof_path) return NextResponse.json({ error: "No proof uploaded" }, { status: 404 });
  const { data, error } = await storeAdminClient().storage.from("store-source").createSignedUrl(order.eft_proof_path, 60);
  if (error || !data) return NextResponse.json({ error: "Couldn't open it" }, { status: 500 });
  return NextResponse.redirect(data.signedUrl, 303);
}
