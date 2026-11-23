import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getEquipmentAccess,
  getProductById,
  updateProduct,
  type EquipmentProduct,
} from "@/services/equipment";
import { goLiveBlockers } from "@/lib/equipment/listing";

const MONEY_FIELDS = [
  "price_day_cents",
  "price_weekend_cents",
  "price_week_cents",
  "deposit_cents",
  "internal_day_cents",
] as const;

function isCents(v: unknown, nullable: boolean) {
  if (v === null) return nullable;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100_000_000;
}

// PATCH /api/equipment/products/[id] — the listing editor (frame 47e-4) and
// the item details form (stage O). Inventory manager only. Going live is refused, in plain words, unless the
// listed_needs_price CHECK would pass (spec rule 1).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const access = await getEquipmentAccess(supabase, user.id);
  if (!access.canManage) {
    return NextResponse.json({ error: "Only the rental manager can change listings." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

  const { data: current } = await getProductById(supabase, id);
  if (!current) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const patch: Partial<EquipmentProduct> = {};

  for (const f of MONEY_FIELDS) {
    if (f in body) {
      const nullable = f === "price_day_cents" || f === "price_weekend_cents" || f === "price_week_cents";
      if (!isCents(body[f], nullable)) {
        return NextResponse.json({ error: `${f} must be a whole number of cents` }, { status: 400 });
      }
      (patch as Record<string, unknown>)[f] = body[f];
    }
  }
  // Internal guide for lost/damaged gear (285). Not a price: it never goes on
  // the store and nothing charges it, so it doesn't touch the listing rules.
  if ("replacement_value_cents" in body) {
    if (!isCents(body.replacement_value_cents, true)) {
      return NextResponse.json({ error: "Replacement value must be a whole number of cents" }, { status: 400 });
    }
    patch.replacement_value_cents = body.replacement_value_cents as number | null;
  }
  if ("can_leave_building" in body) {
    if (typeof body.can_leave_building !== "boolean") {
      return NextResponse.json({ error: "can_leave_building must be true or false" }, { status: 400 });
    }
    patch.can_leave_building = body.can_leave_building;
  }
  if ("description" in body) {
    const d = body.description;
    if (d !== null && (typeof d !== "string" || d.length > 4000)) {
      return NextResponse.json({ error: "Description is too long" }, { status: 400 });
    }
    patch.description = typeof d === "string" && d.trim() ? d.trim() : null;
  }
  if ("included" in body) {
    const inc = body.included;
    if (!Array.isArray(inc) || inc.length > 50 || !inc.every((x) => typeof x === "string" && x.length <= 200)) {
      return NextResponse.json({ error: "What's included must be a list of short lines" }, { status: 400 });
    }
    patch.included = inc.map((x: string) => x.trim()).filter(Boolean);
  }
  if ("specs" in body) {
    const sp = body.specs;
    if (
      !sp ||
      typeof sp !== "object" ||
      Array.isArray(sp) ||
      Object.keys(sp).length > 40 ||
      !Object.values(sp).every((v) => typeof v === "string" && v.length <= 200)
    ) {
      return NextResponse.json({ error: "Specs must be short name: value pairs" }, { status: 400 });
    }
    patch.specs = sp as Record<string, string>;
  }
  if ("store_category_id" in body) {
    const c = body.store_category_id;
    if (c !== null && typeof c !== "string") {
      return NextResponse.json({ error: "Bad store category" }, { status: 400 });
    }
    patch.store_category_id = c as string | null;
  }
  if ("max_per_order" in body) {
    const m = body.max_per_order;
    if (m !== null && !(typeof m === "number" && Number.isInteger(m) && m > 0 && m < 10_000)) {
      return NextResponse.json({ error: "Max per order must be a whole number" }, { status: 400 });
    }
    patch.max_per_order = m as number | null;
  }

  // Inventory details (381). How an item is tracked never changes here: a
  // counted item's history is a count, a tagged one's is its units.
  for (const [field, max, required] of [
    ["name", 120, true],
    ["brand", 80, false],
    ["model", 80, false],
    ["register_category", 40, true],
  ] as const) {
    if (field in body) {
      const v = body[field];
      if (v !== null && typeof v !== "string") return NextResponse.json({ error: `Bad ${field}` }, { status: 400 });
      const t = typeof v === "string" ? v.trim() : "";
      if (t.length > max) return NextResponse.json({ error: `${field.replace("register_", "")} is too long` }, { status: 400 });
      if (required && !t) return NextResponse.json({ error: field === "name" ? "Give it a name." : "Pick a category." }, { status: 400 });
      (patch as Record<string, unknown>)[field] = field === "register_category" ? t.toLowerCase() : t || null;
    }
  }
  if ("location_id" in body) {
    const l = body.location_id;
    if (l !== null && typeof l !== "string") return NextResponse.json({ error: "Bad location" }, { status: 400 });
    patch.location_id = (l as string | null) || null;
  }
  if ("is_requestable" in body) {
    if (typeof body.is_requestable !== "boolean") {
      return NextResponse.json({ error: "is_requestable must be true or false" }, { status: 400 });
    }
    if (body.is_requestable && current.tracking === "consumable") {
      return NextResponse.json({ error: "Consumables are handed out, not lent." }, { status: 400 });
    }
    patch.is_requestable = body.is_requestable;
  }
  if ("reorder_at" in body) {
    const r = body.reorder_at;
    if (r !== null && !(typeof r === "number" && Number.isInteger(r) && r >= 0 && r <= 100_000)) {
      return NextResponse.json({ error: "“Reorder at” has to be a whole number." }, { status: 400 });
    }
    patch.reorder_at = r as number | null;
  }
  if (body.is_listed === true && current.tracking === "consumable") {
    return NextResponse.json({ error: "Consumables can't go on the store." }, { status: 422 });
  }

  // Going live: check the merged result against the same rule as the CHECK.
  if ("is_listed" in body) {
    if (typeof body.is_listed !== "boolean") {
      return NextResponse.json({ error: "is_listed must be true or false" }, { status: 400 });
    }
    if (body.is_listed) {
      const merged = { ...(current as EquipmentProduct), ...patch };
      const blockers = goLiveBlockers(merged);
      if (blockers.length > 0) {
        return NextResponse.json({ error: blockers.join(" "), blockers }, { status: 422 });
      }
      if (!current.is_listed) patch.listed_at = new Date().toISOString();
    }
    patch.is_listed = body.is_listed;
  } else if (current.is_listed) {
    // Editing a live product must not quietly break the rule either.
    const blockers = goLiveBlockers({ ...(current as EquipmentProduct), ...patch });
    if (blockers.length > 0) {
      return NextResponse.json(
        { error: `It's on the store, so take it off first. ${blockers.join(" ")}`, blockers },
        { status: 422 }
      );
    }
  }

  const { data, error } = await updateProduct(supabase, id, patch);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, product: data });
}
