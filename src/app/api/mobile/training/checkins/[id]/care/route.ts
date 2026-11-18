import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { isUuid, NO_STORE } from "@/lib/mobile/training";
import { takeCare } from "@/services/training";

// POST /api/mobile/training/checkins/[id]/care — "I'll take it" on an open
// needs-care flag (48a/48d). RLS and the 334 guard let the school's leaders
// and anyone walking with the student take it; they can change nothing else
// on someone else's check-in. Already taken, or not visible: 404.

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json(
      { error: "unauthenticated", message: "Sign in to use this endpoint." },
      { status: 401, headers: NO_STORE }
    );
  }
  if (!isUuid(id)) {
    return NextResponse.json({ error: "not_found", message: "That flag isn't open any more." }, { status: 404, headers: NO_STORE });
  }
  const { data, error } = await takeCare(supabase, id, user.id, new Date());
  if (error) return NextResponse.json({ error: "server_error", message: error.message }, { status: 500, headers: NO_STORE });
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "not_found", message: "That flag isn't open any more." }, { status: 404, headers: NO_STORE });
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
