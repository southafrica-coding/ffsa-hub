import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteVariant, upsertVariant } from "@/services/store";
import { readJson } from "../../../../_shared";
import { requireStoreStaff } from "../../../_guard";

const schema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(60),
  sku: z.string().trim().max(60).nullable().optional(),
  price_cents: z.number().int().min(0).nullable().optional(),
  stock: z.number().int().min(0).nullable().optional(),
  active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(10_000).optional(),
});

// POST — add or edit a size/variant. DELETE ?variant=<id> — remove one.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireStoreStaff("manage");
  if (!guard.ok) return guard.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the size" }, { status: 400 });
  const { data, error } = await upsertVariant(guard.supabase, { ...parsed.data, product_id: id });
  if (error) return NextResponse.json({ error: /duplicate|unique/i.test(error.message) ? "That size is already listed" : error.message }, { status: 500 });
  return NextResponse.json({ success: true, variant: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireStoreStaff("manage");
  if (!guard.ok) return guard.response;
  const variant = new URL(request.url).searchParams.get("variant");
  if (!variant) return NextResponse.json({ error: "Which size?" }, { status: 400 });
  const { error } = await deleteVariant(guard.supabase, id, variant);
  if (error) {
    // Sold before: keep the row for the order history, just hide it.
    const { error: e2 } = await guard.supabase.from("store_variants").update({ active: false }).eq("id", variant).eq("product_id", id);
    if (e2) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, hidden: true });
  }
  return NextResponse.json({ success: true });
}
