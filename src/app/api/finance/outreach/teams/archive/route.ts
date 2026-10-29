import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { setOutreachTeamArchived } from "@/services/outreach-finance";
import { canManageOutreachTeams } from "@/lib/finance/outreach-team-admin";

/**
 * Archive or unarchive an outreach team (migration 272). Body:
 * { id, archived: boolean }. Outreach administrators only; the RPC and a
 * trigger refuse everyone else too.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { id, archived } = body ?? {};
  if (!id || typeof archived !== "boolean") {
    return NextResponse.json({ error: "id and archived (true/false) are required" }, { status: 400 });
  }

  if (!(await canManageOutreachTeams(supabase))) {
    return NextResponse.json(
      { error: "Only admins and finance staff can archive outreach teams" },
      { status: 403 }
    );
  }

  const { error } = await setOutreachTeamArchived(supabase, id, archived);
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 500 }
    );
  }

  return NextResponse.json({ success: true, archived });
}
