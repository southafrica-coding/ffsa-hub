import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Change how many people are on an outreach team. Every budget line that
// follows the team size is re-totalled by the database (migration 236).
export async function POST(request: Request) {
  // Untyped: migration 236 tables and RPCs are not in the generated types yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { team_id, size } = (await request.json()) as { team_id?: string; size?: number };
  if (!team_id || size == null || !Number.isFinite(Number(size))) {
    return NextResponse.json({ error: "team_id and size are required" }, { status: 400 });
  }

  const { error } = await supabase.rpc("set_outreach_team_size", {
    p_team: team_id,
    p_size: Math.round(Number(size)),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
