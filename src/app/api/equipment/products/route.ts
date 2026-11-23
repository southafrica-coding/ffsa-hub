import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import {
  createProduct,
  getEquipmentAccess,
  insertStockMove,
  insertUnits,
  insertUnitEvent,
  listProductSlugs,
  listTagsWithPrefix,
} from "@/services/equipment";
import { inventoryErrorText, nextTags, readNewItem, uniqueSlug } from "@/lib/equipment/inventory";

// POST /api/equipment/products — Add item (stage O). Inventory manager only.
// Counted and consumable items get their first count as an 'opening' stock
// move, so the count has a history from day one. Tagged items get their
// units, numbered on from the highest tag with that prefix.
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const access = await getEquipmentAccess(supabase, user.id);
  if (!access.canManage) {
    return NextResponse.json({ error: "Only the inventory manager can add items." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }
  const read = readNewItem(body);
  if ("error" in read) return NextResponse.json({ error: read.error }, { status: 400 });
  const item = read.item;

  const { data: slugRows, error: slugErr } = await listProductSlugs(supabase);
  if (slugErr) return NextResponse.json({ error: slugErr.message }, { status: 500 });
  const slug = uniqueSlug(item.name, ((slugRows ?? []) as { slug: string }[]).map((r) => r.slug));

  const { data: product, error } = await createProduct(supabase, {
    name: item.name,
    slug,
    brand: item.brand,
    model: item.model,
    description: item.description,
    register_category: item.category,
    tracking: item.tracking,
    location_id: item.tracking === "tagged" ? null : item.locationId,
    is_requestable: item.isRequestable,
    reorder_at: item.reorderAt,
    replacement_value_cents: item.unitCostCents,
    created_by: user.id,
  });
  if (error || !product) return NextResponse.json({ error: error?.message ?? "Couldn't add the item." }, { status: 500 });

  if (item.tracking === "tagged") {
    const { data: tagRows } = await listTagsWithPrefix(supabase, item.tagPrefix!);
    const tags = nextTags(item.tagPrefix!, ((tagRows ?? []) as { tag: string }[]).map((r) => r.tag), item.quantity);
    const { data: units, error: unitErr } = await insertUnits(
      supabase,
      tags.map((tag) => ({
        product_id: product.id,
        tag,
        location_id: item.locationId,
        supplier: item.supplier,
        purchase_date: item.purchaseDate,
        purchase_price_cents: item.unitCostCents,
        condition: "New",
      }))
    );
    if (unitErr) {
      return NextResponse.json(
        { error: `The item was added but its units weren't: ${unitErr.message}`, productId: product.id },
        { status: 500 }
      );
    }
    await Promise.all(
      ((units ?? []) as { id: string; tag: string }[]).map((u) =>
        insertUnitEvent(supabase, { unit_id: u.id, kind: "added", detail: "Added in the Hub.", actor_id: user.id })
      )
    );
  } else if (item.quantity > 0) {
    const { error: moveErr } = await insertStockMove(supabase, {
      product_id: product.id,
      delta: item.quantity,
      reason: "opening",
      note: "Added in the Hub.",
      supplier: item.supplier,
      unit_cost_cents: item.unitCostCents,
      ...(item.purchaseDate ? { happened_on: item.purchaseDate } : {}),
      actor_id: user.id,
    });
    if (moveErr) {
      return NextResponse.json(
        { error: `The item was added but its count wasn't: ${inventoryErrorText(moveErr.message)}`, productId: product.id },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ success: true, productId: product.id });
}
