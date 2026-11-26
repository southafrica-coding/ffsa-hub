import { NextResponse } from "next/server";
import { normaliseProductInput } from "@/lib/store/catalogue";
import { createProduct } from "@/services/store";
import { readJson } from "../../_shared";
import { requireStoreStaff } from "../_guard";

// POST /api/store/admin/products — create a product (catalogue as data).
export async function POST(request: Request) {
  const guard = await requireStoreStaff("manage");
  if (!guard.ok) return guard.response;
  const input = normaliseProductInput(await readJson(request));
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
  const { data, error } = await createProduct(guard.supabase, { ...input.row, created_by: guard.userId });
  if (error) {
    const dup = /duplicate|unique/i.test(error.message);
    return NextResponse.json({ error: dup ? "Another product already uses that link name" : error.message }, { status: dup ? 409 : 500 });
  }
  return NextResponse.json({ success: true, product: data });
}
