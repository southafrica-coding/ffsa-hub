import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Edit mode on the org chart (frame 43b, migration 252). Every write is a
// SECURITY DEFINER function called with the CALLER's client: the database
// checks org.manage and the field whitelist itself, and auth.uid() lands in
// the edit log so History can say who changed what.
const TABLES = new Set(["staff_ministries", "staff_ministry_members", "okr_objectives"]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // The org functions postdate the generated database.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = supabase;
  const body = await request.json().catch(() => ({}));
  const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

  let result;
  switch (body.op) {
    case "field":
      if (!TABLES.has(body.table) || !isId(body.id) || typeof body.field !== "string")
        return NextResponse.json({ error: "Bad edit" }, { status: 400 });
      result = await db.rpc("org_edit_field", {
        p_table: body.table,
        p_id: body.id,
        p_field: body.field,
        p_value: body.value ?? null,
      });
      break;
    case "shepherd":
      if (!isId(body.ministry_id) || (body.user_id !== null && !isId(body.user_id)))
        return NextResponse.json({ error: "Bad shepherd" }, { status: 400 });
      result = await db.rpc("org_set_shepherd", { p_ministry: body.ministry_id, p_user: body.user_id });
      break;
    case "layout":
      if (!isId(body.ministry_id)) return NextResponse.json({ error: "Bad layout" }, { status: 400 });
      result = await db.rpc("org_set_layout", {
        p_ministry: body.ministry_id,
        p_x: typeof body.x === "number" ? body.x : null,
        p_y: typeof body.y === "number" ? body.y : null,
      });
      break;
    case "undo":
      if (!isId(body.log_id)) return NextResponse.json({ error: "Bad undo" }, { status: 400 });
      result = await db.rpc("org_undo", { p_log_id: body.log_id });
      break;
    default:
      return NextResponse.json({ error: "Unknown edit" }, { status: 400 });
  }

  if (result.error) {
    const status = /not authorised/i.test(result.error.message) ? 403 : 400;
    return NextResponse.json({ error: result.error.message }, { status });
  }
  return NextResponse.json({ success: true, savedAt: new Date().toISOString() });
}
