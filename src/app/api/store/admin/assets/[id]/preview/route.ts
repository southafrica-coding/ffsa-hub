import { NextResponse } from "next/server";
import { z } from "zod";
import { setPreviewPages } from "@/services/store";
import { readJson } from "../../../../_shared";
import { requireStoreStaff } from "../../../_guard";

const schema = z.object({ pages: z.array(z.number().int().min(1)).max(12) });

// PUT /api/store/admin/assets/[id]/preview — which pages anyone can flip
// through on the product page (up to 12).
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireStoreStaff("manage");
  if (!guard.ok) return guard.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Pick up to 12 preview pages" }, { status: 400 });
  const { error } = await setPreviewPages(guard.supabase, id, [...new Set(parsed.data.pages)]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
