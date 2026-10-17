import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// One outreach budget line: amount × frequency × people. The total is
// computed by the database trigger (migration 236) and never accepted
// from the client; RLS decides who may write (can_edit_outreach_budget).

type LineBody = {
  category_id?: string;
  description?: string;
  amount_zar?: number;
  frequency?: number;
  uses_team_size?: boolean;
  fixed_people?: number;
  sort_order?: number;
  plan_kind?: "trip" | "range" | "day";
  plan_start?: string | null;
  plan_end?: string | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function clean(body: LineBody) {
  const out: Record<string, unknown> = {};
  if (body.category_id !== undefined) out.category_id = body.category_id;
  if (body.description !== undefined) out.description = String(body.description).trim();
  if (body.amount_zar !== undefined) out.amount_zar = Math.max(0, Number(body.amount_zar) || 0);
  if (body.frequency !== undefined) out.frequency = Math.max(0, Number(body.frequency) || 0);
  if (body.uses_team_size !== undefined) out.uses_team_size = Boolean(body.uses_team_size);
  if (body.fixed_people !== undefined)
    out.fixed_people = Math.max(0, Math.round(Number(body.fixed_people) || 0));
  if (body.sort_order !== undefined) out.sort_order = Math.round(Number(body.sort_order) || 0);
  // When the money goes out (daily/weekly plan). Dates that don't fit the
  // kind are dropped rather than stored half-set.
  if (body.plan_kind !== undefined) {
    const kind = ["trip", "range", "day"].includes(body.plan_kind) ? body.plan_kind : "trip";
    const start = body.plan_start && ISO.test(body.plan_start) ? body.plan_start : null;
    let end = body.plan_end && ISO.test(body.plan_end) ? body.plan_end : null;
    if (kind === "range" && start && end && end < start) end = null;
    if ((kind === "day" && !start) || (kind === "range" && (!start || !end))) {
      out.plan_kind = "trip";
      out.plan_start = null;
      out.plan_end = null;
    } else {
      out.plan_kind = kind;
      out.plan_start = kind === "trip" ? null : start;
      out.plan_end = kind === "range" ? end : null;
    }
  }
  return out;
}

async function authed() {
  // Untyped: migration 236 tables and RPCs are not in the generated types yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function POST(request: Request) {
  const { supabase, user } = await authed();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json()) as LineBody & { team_id?: string };
  const fields = clean(body);
  if (!body.team_id || !fields.category_id || !fields.description) {
    return NextResponse.json(
      { error: "team_id, category_id and description are required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("outreach_budget_lines")
    .insert({ ...fields, team_id: body.team_id, source: "manual", created_by: user.id })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true, line: data });
}

export async function PATCH(request: Request) {
  const { supabase, user } = await authed();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json()) as LineBody & { id?: string };
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const fields = clean(body);
  if (fields.description === "") {
    return NextResponse.json({ error: "Description can't be empty" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("outreach_budget_lines")
    .update(fields)
    .eq("id", body.id)
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // RLS filters a forbidden update to zero rows rather than erroring.
  if (!data) return NextResponse.json({ error: "Not allowed to edit this line" }, { status: 403 });
  return NextResponse.json({ success: true, line: data });
}

export async function DELETE(request: Request) {
  const { supabase, user } = await authed();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("outreach_budget_lines")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data?.length) return NextResponse.json({ error: "Not allowed to delete this line" }, { status: 403 });
  return NextResponse.json({ success: true });
}
