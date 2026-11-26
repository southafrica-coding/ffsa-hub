import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateStep } from "@/services/visiting-teams";

// PATCH /api/operations/visiting-teams/[id]/steps/[stepId] — tick, untick,
// or note one checklist step. RLS: the lead, or this team's host.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; stepId: string }> }) {
  const { id, stepId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (body.done !== undefined) {
    if (typeof body.done !== "boolean") return NextResponse.json({ error: "Bad value" }, { status: 400 });
    patch.done_at = body.done ? new Date().toISOString() : null;
    patch.done_by = body.done ? user.id : null;
  }
  if (body.note !== undefined) {
    if (body.note !== null && typeof body.note !== "string") return NextResponse.json({ error: "Bad note" }, { status: 400 });
    const t = typeof body.note === "string" ? body.note.trim() : "";
    if (t.length > 2000) return NextResponse.json({ error: "Note is too long" }, { status: 400 });
    patch.note = t || null;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });

  const { data, error } = await updateStep(supabase, id, stepId, patch);
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Step not found" }, { status: error ? 500 : 404 });
  return NextResponse.json({ success: true });
}
