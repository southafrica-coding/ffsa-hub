import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { NO_STORE, canSeeList, resolveListAccess } from "@/lib/mobile/ministries";

// GET /api/mobile/ministries/access — may the caller open the Ministries
// list? The phone asks this to decide whether to show its Home shortcut
// (UX only: the list and detail endpoints check again). Same rule as the
// web /ministry page; reads only the caller's own roles and leader rows
// through their own client, never the service-role one.

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json(
      { error: "unauthenticated", message: "Sign in to use this endpoint." },
      { status: 401, headers: NO_STORE }
    );
  }

  const access = await resolveListAccess(supabase, user.id);
  return NextResponse.json(
    { canView: canSeeList(access), scope: access.seesEverything ? "all" : "led" },
    { headers: NO_STORE }
  );
}
