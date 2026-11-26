import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { NO_STORE, weekOf } from "@/lib/mobile/training";
import { isoWeek } from "@/lib/mobile/training-today";
import { setDismissed } from "@/services/training-today";

// POST /api/mobile/training/today/dismiss { key, done } — tick a Today item
// off (or back on) for this ISO week. It only hides the line; the work is
// done on the screen the line opens. Own rows only (RLS, migration 334).

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json(
      { error: "unauthenticated", message: "Sign in to use this endpoint." },
      { status: 401, headers: NO_STORE }
    );
  }
  const body = (await request.json().catch(() => null)) as { key?: unknown; done?: unknown } | null;
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (!key || key.length > 200 || typeof body?.done !== "boolean") {
    return NextResponse.json({ error: "invalid", message: "Which item, and done or not?" }, { status: 400, headers: NO_STORE });
  }
  const { error } = await setDismissed(supabase, user.id, key, isoWeek(weekOf(new Date())), body.done);
  if (error) return NextResponse.json({ error: "server_error", message: error.message }, { status: 500, headers: NO_STORE });
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
