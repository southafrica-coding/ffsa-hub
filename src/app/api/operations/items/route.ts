import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isOpsTeam } from "@/lib/operations/access";
import { isAreaKey } from "@/lib/operations/areas";
import { applyChange, displayName } from "@/lib/operations/change";
import { addUpdates, createItem, getUserBrief } from "@/services/operations";

// POST /api/operations/items — add an item (operations team only).
// From the meeting page `via: "meeting"`; it can carry an owner and a date,
// and the owner is told straight away.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await isOpsTeam(supabase, user.id))) {
    return NextResponse.json({ error: "Operations team only" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const via = body.via === "meeting" ? "meeting" : "hub";
  if (!isAreaKey(body.area) || title.length < 2 || title.length > 200) {
    return NextResponse.json({ error: "An area and a title (2–200 characters) are needed" }, { status: 400 });
  }
  const dueOn = typeof body.due_on === "string" && body.due_on ? body.due_on : null;
  if (dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return NextResponse.json({ error: "Bad date" }, { status: 400 });
  const ownerUserId = typeof body.owner_user_id === "string" && body.owner_user_id ? body.owner_user_id : null;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

  const { data, error } = await createItem(supabase, {
    area: body.area,
    title,
    details: str(body.details, 4000),
    location: str(body.location, 120),
    source: via,
    created_by: user.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: me } = await getUserBrief(supabase, user.id);
  const actor = { userId: user.id, name: displayName(me) };
  await addUpdates(supabase, [{ item_id: data.id, author_user_id: user.id, author_name: actor.name, kind: "created", via }]);

  // Owner and date go through applyChange so the log and the DM match an edit.
  if (ownerUserId || dueOn) {
    const res = await applyChange(supabase, {
      itemId: data.id,
      ownerUserId: ownerUserId ?? undefined,
      dueOn: dueOn ?? undefined,
      actor,
      via,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  }
  return NextResponse.json({ success: true, id: data.id });
}
