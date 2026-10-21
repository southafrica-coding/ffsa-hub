import { after, NextResponse } from "next/server";
import { checkCashAlert } from "@/lib/outreach/cash-alerts";
import { createClient } from "@/lib/supabase/server";
import {
  createFundRelease,
  updateFundRelease,
  deleteFundRelease,
} from "@/services/outreach-finance";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();

  if (!body.team_id || !body.label || body.amount_zar == null) {
    return NextResponse.json(
      { error: "team_id, label, and amount_zar are required" },
      { status: 400 }
    );
  }

  const { data, error } = await createFundRelease(supabase, {
    ...body,
    created_by: user.id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Money changed: maybe tell the team's leaders it is running low.
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

  const { data, error } = await updateFundRelease(supabase, id, updates);

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

  const { data: before } = await supabase.from("outreach_fund_releases").select("team_id").eq("id", id).maybeSingle();
  const { error } = await deleteFundRelease(supabase, id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (before?.team_id) after(() => checkCashAlert(before.team_id));
  return NextResponse.json({ success: true });
}
