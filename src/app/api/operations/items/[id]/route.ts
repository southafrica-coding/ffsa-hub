import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isStatus } from "@/lib/operations/areas";
import { applyChange, displayName } from "@/lib/operations/change";
import { getUserBrief } from "@/services/operations";

// PATCH /api/operations/items/[id] — status, note, owner, date.
// RLS decides who may: the operations team, or the person it was given to
// (who may move status and add notes, but not hand it on or re-date it).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (body.status !== undefined && !isStatus(body.status)) {
    return NextResponse.json({ error: "Unknown status" }, { status: 400 });
  }
  if (body.due_on !== undefined && body.due_on !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.due_on))) {
    return NextResponse.json({ error: "Bad date" }, { status: 400 });
  }
  if (body.note !== undefined && body.note !== null && typeof body.note !== "string") {
    return NextResponse.json({ error: "Bad note" }, { status: 400 });
  }

  const { data: me } = await getUserBrief(supabase, user.id);
  const result = await applyChange(supabase, {
    itemId: id,
    status: body.status,
    note: body.note ?? null,
    ownerUserId: body.owner_user_id === undefined ? undefined : body.owner_user_id || null,
    dueOn: body.due_on === undefined ? undefined : body.due_on || null,
    actor: { userId: user.id, name: displayName(me) },
    via: body.via === "meeting" ? "meeting" : "hub",
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ success: true });
}
