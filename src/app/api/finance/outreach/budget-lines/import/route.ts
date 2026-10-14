import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Import a budget sheet's lines in one transaction. Re-importing replaces
// the previous imported lines (hand-added lines stay), so running the same
// sheet twice never doubles the budget. See import_outreach_budget (236).

type ImportLine = {
  category_id: string;
  description: string;
  amount_zar: number;
  frequency: number;
  uses_team_size: boolean;
  fixed_people: number;
  sheet_total_zar: number | null;
};

export async function POST(request: Request) {
  // Untyped: migration 236 tables and RPCs are not in the generated types yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json()) as {
    team_id?: string;
    filename?: string;
    team_size?: number | null;
    lines?: ImportLine[];
  };

  if (!body.team_id || !Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: "team_id and at least one line are required" }, { status: 400 });
  }
  if (body.lines.length > 500) {
    return NextResponse.json({ error: "That sheet has more than 500 lines" }, { status: 400 });
  }
  if (body.lines.some((l) => !l.category_id || !String(l.description ?? "").trim())) {
    return NextResponse.json({ error: "Every line needs a description and a category" }, { status: 400 });
  }

  // Team size first, so lines that follow it are totalled at the new size.
  if (body.team_size != null) {
    const { error } = await supabase.rpc("set_outreach_team_size", {
      p_team: body.team_id,
      p_size: Math.round(Number(body.team_size)),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const lines = body.lines.map((l, i) => ({
    category_id: l.category_id,
    description: String(l.description).trim(),
    amount_zar: Math.max(0, Number(l.amount_zar) || 0),
    frequency: Math.max(0, Number(l.frequency) || 0),
    uses_team_size: Boolean(l.uses_team_size),
    fixed_people: Math.max(0, Math.round(Number(l.fixed_people) || 0)),
    sheet_total_zar: l.sheet_total_zar == null ? null : Number(l.sheet_total_zar),
    sort_order: i,
  }));

  const { data, error } = await supabase.rpc("import_outreach_budget", {
    p_team: body.team_id,
    p_filename: body.filename ?? null,
    p_lines: lines,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true, result: data });
}
