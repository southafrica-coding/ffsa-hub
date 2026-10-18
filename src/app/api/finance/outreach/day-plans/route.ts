import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Save day plans (the team lead's food / accommodation planner). One call
// can save a single typed-in day or a whole "Spread evenly" / "Clear week"
// at once. A day set to nothing (no amount, no note) is removed. RLS on
// outreach_day_plans decides who may write (can_edit_outreach_budget).

const ISO = /^\d{4}-\d{2}-\d{2}$/;

type DayInput = { plan_date?: string; amount_zar?: number | null; note?: string | null };

export async function PUT(request: Request) {
  // Untyped: outreach_day_plans (migration 252) isn't in the generated types yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json()) as { team_id?: string; category_id?: string; days?: DayInput[] };
  if (!body.team_id || !body.category_id || !Array.isArray(body.days) || body.days.length === 0) {
    return NextResponse.json({ error: "team_id, category_id and days are required" }, { status: 400 });
  }
  if (body.days.length > 400) return NextResponse.json({ error: "Too many days" }, { status: 400 });

  const keep: Record<string, unknown>[] = [];
  const drop: string[] = [];
  for (const d of body.days) {
    if (!d.plan_date || !ISO.test(d.plan_date)) {
      return NextResponse.json({ error: "Every day needs a date (YYYY-MM-DD)" }, { status: 400 });
    }
    const amount = Math.max(0, Math.round(Number(d.amount_zar ?? 0) * 100) / 100);
    if (!Number.isFinite(amount)) return NextResponse.json({ error: "Amounts must be numbers" }, { status: 400 });
    const note = (d.note ?? "").toString().trim().slice(0, 200) || null;
    if (amount === 0 && !note) drop.push(d.plan_date);
    else
      keep.push({
        team_id: body.team_id,
        category_id: body.category_id,
        plan_date: d.plan_date,
        amount_zar: amount,
        note,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      });
  }

  if (keep.length) {
    const { data, error } = await supabase
      .from("outreach_day_plans")
      .upsert(keep, { onConflict: "team_id,category_id,plan_date" })
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if ((data ?? []).length < keep.length) {
      return NextResponse.json({ error: "You don't have permission to plan for this team" }, { status: 403 });
    }
  }
  if (drop.length) {
    const { error } = await supabase
      .from("outreach_day_plans")
      .delete()
      .eq("team_id", body.team_id)
      .eq("category_id", body.category_id)
      .in("plan_date", drop);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ success: true, saved: keep.length, cleared: drop.length });
}
