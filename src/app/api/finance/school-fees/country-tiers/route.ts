import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance } from "@/lib/api-auth";
import {
  getCountryTiers,
  upsertCountryTier,
  deleteCountryTier,
} from "@/services/school-fees";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data, error } = await getCountryTiers(supabase);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!(await canManageFinance(supabase, user.id))) {
    return NextResponse.json(
      { error: "You don't have permission to edit the country tier list" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { country_name, tier } = body;

  if (!country_name || !tier) {
    return NextResponse.json(
      { error: "country_name and tier are required" },
      { status: 400 }
    );
  }

  if (!["A", "B", "C"].includes(tier)) {
    return NextResponse.json(
      { error: "tier must be A, B, or C" },
      { status: 400 }
    );
  }

  const { data, error } = await upsertCountryTier(supabase, {
    country_name,
    tier,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

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

  if (!(await canManageFinance(supabase, user.id))) {
    return NextResponse.json(
      { error: "You don't have permission to edit the country tier list" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { country_name, tier } = body;

  if (!country_name || !tier) {
    return NextResponse.json(
      { error: "country_name and tier are required" },
      { status: 400 }
    );
  }

  const { data, error } = await upsertCountryTier(supabase, {
    country_name,
    tier,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

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

  if (!(await canManageFinance(supabase, user.id))) {
    return NextResponse.json(
      { error: "You don't have permission to edit the country tier list" },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { error } = await deleteCountryTier(supabase, id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
