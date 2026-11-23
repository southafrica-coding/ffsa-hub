import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { countLine, getEquipmentAccess, getOrderById, type EquipmentOrderFull } from "@/services/equipment";
import { inventoryErrorText, readCount } from "@/lib/equipment/inventory";

// POST /api/equipment/orders/[id]/count — count a counted line out or back.
// Body: { lineId, stage: "out" | "back", count, damaged?, missing?, note? }.
// equipment_count_line (381) re-checks everything, takes damaged and missing
// off the stock, and moves an all-counted order to out / returned.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const access = await getEquipmentAccess(supabase, user.id);
  if (!access.canOperate) {
    return NextResponse.json({ error: "Only the inventory team can count orders." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

  const { data } = await getOrderById(supabase, id);
  const order = data as EquipmentOrderFull | null;
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const line = order.lines.find((l) => l.id === body.lineId);
  if (!line) return NextResponse.json({ error: "That line isn't on this order." }, { status: 400 });
  if (line.product?.tracking !== "counted") {
    return NextResponse.json({ error: "Tagged gear is scanned, not counted." }, { status: 400 });
  }

  const read = readCount(body, {
    quantity: line.quantity,
    qty_out: line.qty_out ?? null,
    qty_back: line.qty_back ?? null,
  });
  if ("error" in read) return NextResponse.json({ error: read.error }, { status: 400 });
  const c = read.count;

  const { error } = await countLine(supabase, {
    lineId: line.id,
    stage: c.stage,
    count: c.count,
    damaged: c.stage === "back" ? c.damaged : 0,
    missing: c.stage === "back" ? c.missing : 0,
    note: c.note,
  });
  if (error) return NextResponse.json({ error: inventoryErrorText(error.message) }, { status: 400 });
  return NextResponse.json({ success: true });
}
