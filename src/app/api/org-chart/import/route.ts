import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Resolve rows of the org import queue (migration 250). Every write goes
// through a SECURITY DEFINER function called with the CALLER's client, so the
// database checks org.manage itself and auth.uid() lands in the edit log and
// in added_by — the service role would record nobody.
const PROPOSALS = new Set(["membership", "oversees", "integrates", "alongside"]);

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
  const action = body.action as string | undefined;
  const id = typeof body.id === "string" ? body.id : undefined;

  let result;
  switch (action) {
    case "apply_exact":
      result = await db.rpc("org_import_apply_exact");
      break;
    case "apply": {
      if (!id || typeof body.user_id !== "string")
        return NextResponse.json({ error: "Choose a person first" }, { status: 400 });
      if (body.proposal && !PROPOSALS.has(body.proposal))
        return NextResponse.json({ error: "Unknown kind of link" }, { status: 400 });
      result = await db.rpc("org_import_apply", {
        p_queue_id: id,
        p_user_id: body.user_id,
        p_proposal: body.proposal ?? null,
        p_ministry_id: typeof body.ministry_id === "string" ? body.ministry_id : null,
      });
      break;
    }
    case "dismiss":
      if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      result = await db.rpc("org_import_dismiss", {
        p_queue_id: id,
        p_note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
      });
      break;
    case "reopen":
      if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      result = await db.rpc("org_import_reopen", { p_queue_id: id });
      break;
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  if (result.error) {
    const status = /not authorised/i.test(result.error.message) ? 403 : 400;
    return NextResponse.json({ error: result.error.message }, { status });
  }
  return NextResponse.json({ success: true, result: result.data });
}
