import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { confirmPartnership, FamilyError } from "@/services/family";

// POST /api/family/partnership/confirm — partner B accepts or declines a
// pending spouse link that named them.
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    await confirmPartnership(
      createAdminClient(),
      user.id,
      body.id,
      body.accept !== false
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof FamilyError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
