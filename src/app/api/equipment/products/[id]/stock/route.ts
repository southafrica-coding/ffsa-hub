import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { getEquipmentAccess, getProductById, insertStockMove, type EquipmentProduct } from "@/services/equipment";
import { inventoryErrorText, moveRow, readMove } from "@/lib/equipment/inventory";

// POST /api/equipment/products/[id]/stock — record a stock change on a
// counted or consumable item: bought more, found, handed out, lost, damaged,
// or (manager only) a recount. The trigger from 381 applies it to the count.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const access = await getEquipmentAccess(supabase, user.id);
  if (!access.canOperate) {
    return NextResponse.json({ error: "Only the inventory team can change stock." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }
  const read = readMove(body);
  if ("error" in read) return NextResponse.json({ error: read.error }, { status: 400 });

  const { data } = await getProductById(supabase, id);
  const product = data as EquipmentProduct | null;
  if (!product) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  const built = moveRow(read.move, product.tracking, product.stock_quantity, access.canManage);
  if ("error" in built) return NextResponse.json({ error: built.error }, { status: 400 });

  const { data: move, error } = await insertStockMove(supabase, {
    product_id: id,
    ...built.row,
    actor_id: user.id,
  });
  if (error) return NextResponse.json({ error: inventoryErrorText(error.message) }, { status: 400 });
  return NextResponse.json({ success: true, move, stock: product.stock_quantity + built.row.delta });
}
