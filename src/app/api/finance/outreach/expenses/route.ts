import { after, NextResponse } from "next/server";
import { checkCashAlert } from "@/lib/outreach/cash-alerts";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/finance/outreach-access";
import {
  createExpense,
  getExpenseById,
  updateExpense,
  deleteExpense,
} from "@/services/outreach-finance";

// Postgres error codes, as PostgREST reports them.
const UNIQUE_VIOLATION = "23505";
const RLS_VIOLATION = "42501";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();

  if (!body.team_id || !body.category_id || !body.expense_date || body.zar_amount == null) {
    return NextResponse.json(
      { error: "team_id, category_id, expense_date, and zar_amount are required" },
      { status: 400 }
    );
  }

  // The phone app picks the expense's id itself, so a save it retries after a
  // dropped connection can be recognised instead of logged twice. The website
  // never sends one.
  if (body.id !== undefined && !isUuid(body.id)) {
    return NextResponse.json({ error: "id must be a UUID" }, { status: 400 });
  }

  const { data, error } = await createExpense(supabase, {
    ...body,
    created_by: user.id,
  });

  if (error) {
    // Same id again: the first save got through. Answer with that row (read
    // through RLS, so only one the caller may see) rather than an error.
    if (error.code === UNIQUE_VIOLATION && body.id) {
      const { data: existing } = await getExpenseById(supabase, body.id);
      if (existing && existing.team_id === body.team_id) {
        return NextResponse.json({ success: true, data: existing, replayed: true });
      }
      return NextResponse.json({ error: "That expense id is already taken" }, { status: 409 });
    }
    if (error.code === RLS_VIOLATION) {
      return NextResponse.json(
        { error: "You don't have permission to add expenses to this team" },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Money changed: maybe tell the team's school leader it is running low.
  after(() => checkCashAlert(body.team_id));
  return NextResponse.json({ success: true, data });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { data, error } = await updateExpense(supabase, id, updates);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (data?.team_id) after(() => checkCashAlert(data.team_id));
  return NextResponse.json({ success: true, data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { data: before } = await supabase.from("outreach_expenses").select("team_id").eq("id", id).maybeSingle();
  const { error } = await deleteExpense(supabase, id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (before?.team_id) after(() => checkCashAlert(before.team_id));
  return NextResponse.json({ success: true });
}
