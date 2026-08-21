import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { callerCanManageCycles } from "@/lib/auth/check-okr-access";
import { createCycle, listCycles } from "@/services/okrs";

export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await listCycles(supabase);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ cycles: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!(await callerCanManageCycles(supabase, user.id))) {
    return NextResponse.json({ error: "Only leadership can open a cycle" }, { status: 403 });
  }

  const body = await request.json();
  const { name, slug, starts_on, ends_on } = body;

  if (!name?.trim() || !slug?.trim() || !starts_on || !ends_on) {
    return NextResponse.json(
      { error: "name, slug, starts_on and ends_on are required" },
      { status: 400 }
    );
  }
  if (ends_on < starts_on) {
    return NextResponse.json({ error: "The cycle cannot end before it starts" }, { status: 400 });
  }

  const { data, error } = await createCycle(supabase, {
    name: name.trim(),
    slug: slug.trim().toLowerCase(),
    starts_on,
    ends_on,
  });

  if (error) {
    const conflict = error.code === "23505";
    return NextResponse.json(
      { error: conflict ? "A cycle with that reference already exists" : error.message },
      { status: conflict ? 409 : 500 }
    );
  }
  return NextResponse.json({ success: true, cycle: data });
}
