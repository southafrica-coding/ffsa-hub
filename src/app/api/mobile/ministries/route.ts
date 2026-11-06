import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { listMinistries } from "@/services/ministries";
import { NO_STORE, canSeeList, resolveListAccess, shapeList } from "@/lib/mobile/ministries";

// GET /api/mobile/ministries — the phone app's Ministries list. Same gate as
// the web /ministry page: admin or Leadership Team see every ministry, a
// ministry leader sees the ones they lead, anyone else gets 403 (the web
// page redirects them away). Only after that check is the service-role
// client used, exactly as the web page does. Contract: src/lib/mobile/ministries.ts.

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
  if (!canSeeList(access)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403, headers: NO_STORE });
  }

  const admin = createAdminClient();
  const { data, error } = await listMinistries(admin);
  if (error) {
    return NextResponse.json(
      { error: "server_error", message: error.message },
      { status: 500, headers: NO_STORE }
    );
  }

  return NextResponse.json(shapeList(data ?? [], access), { headers: NO_STORE });
}
