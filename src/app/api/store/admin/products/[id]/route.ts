import { NextResponse } from "next/server";
import { normaliseProductInput } from "@/lib/store/catalogue";
import { updateProduct } from "@/services/store";
import { readJson } from "../../../_shared";
import { requireStoreStaff } from "../../_guard";

// PATCH /api/store/admin/products/[id] — save the whole product form.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireStoreStaff("manage");
  if (!guard.ok) return guard.response;
  const input = normaliseProductInput(await readJson(request));
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
  const { data, error } = await updateProduct(guard.supabase, id, input.row);
  if (error) {
    const dup = /duplicate|unique/i.test(error.message);
    return NextResponse.json({ error: dup ? "Another product already uses that link name" : error.message }, { status: dup ? 409 : 500 });
  }
  return NextResponse.json({ success: true, product: data });
}
