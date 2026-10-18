import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { personName } from "@/services/org-import";

// What changed on one ministry, newest first (org_history, migration 252 —
// it returns nothing unless the caller has org.manage). Names for the people
// who made each change, and the people it was about, come from the service
// role afterwards: the users table is not readable across the board.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const ministry = new URL(request.url).searchParams.get("ministry");
  if (!ministry || !/^[0-9a-f-]{36}$/i.test(ministry))
    return NextResponse.json({ error: "ministry is required" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = supabase;
  const { data, error } = await db.rpc("org_history", { p_ministry: ministry, p_limit: 150 });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const rows = (data ?? []) as {
    id: string;
    table_name: string;
    action: string;
    field: string | null;
    before: unknown;
    after: unknown;
    actor_id: string | null;
    created_at: string;
    undone_at: string | null;
    undo_of: string | null;
    subject_user_id: string | null;
  }[];

  const ids = [...new Set(rows.flatMap((r) => [r.actor_id, r.subject_user_id]).filter(Boolean))] as string[];
  // Shepherd changes carry a user id as their value; name those too.
  for (const r of rows)
    if (r.table_name === "okr_shepherds")
      for (const v of [r.before, r.after])
        if (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)) ids.push(v);

  const names: Record<string, string> = {};
  if (ids.length) {
    const { data: users } = await createAdminClient()
      .from("users")
      .select("id, first_name, last_name, preferred_name, display_name, email")
      .in("id", [...new Set(ids)]);
    for (const u of users ?? []) names[u.id] = personName(u);
  }

  return NextResponse.json({ rows, names });
}
