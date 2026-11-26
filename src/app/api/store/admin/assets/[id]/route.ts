import { NextResponse } from "next/server";
import type { StoreAsset } from "@/lib/store/types";
import { getAsset } from "@/services/store";
import { requireStoreStaff } from "../../_guard";

// GET /api/store/admin/assets/[id] — progress of an upload's render, for
// the admin page to poll.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireStoreStaff("view");
  if (!guard.ok) return guard.response;
  const { data } = (await getAsset(guard.supabase, id)) as { data: StoreAsset | null };
  if (!data) return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  return NextResponse.json(
    { id: data.id, status: data.status, pages: data.page_count, error: data.error, filename: data.filename, byteSize: data.byte_size },
    { headers: { "Cache-Control": "no-store" } }
  );
}
