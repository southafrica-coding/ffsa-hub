import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { getMinistry, getMinistryRoster, listSubcategories } from "@/services/ministries";
import {
  NO_STORE,
  ministryIdSchema,
  resolveDetailAccess,
  shapeDetail,
} from "@/lib/mobile/ministries";

// GET /api/mobile/ministries/[id] — one ministry's roster for the phone app.
// Same gate as the web /ministry/[id] page: admin, a leader of THIS ministry,
// or Leadership Team may view; canManage (admin or this ministry's leader) is
// returned so the app knows whether to offer the existing manage actions —
// which still go through /api/ministries/[id]/** and are checked again there.
// Unlike the web page this never sends the pickable-users list.

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json(
      { error: "unauthenticated", message: "Sign in to use this endpoint." },
      { status: 401, headers: NO_STORE }
    );
  }

  const parsed = ministryIdSchema.safeParse((await params).id);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400, headers: NO_STORE });
  }
  const id = parsed.data;

  const access = await resolveDetailAccess(supabase, user.id, id);
  if (!access.canView) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403, headers: NO_STORE });
  }

  const admin = createAdminClient();
  const [ministry, roster, subcategories] = await Promise.all([
    getMinistry(admin, id),
    getMinistryRoster(admin, id),
    listSubcategories(admin, id),
  ]);
  if (!ministry.data) {
    // .single() on no rows reports PGRST116; anything else is a real failure.
    if (ministry.error && ministry.error.code !== "PGRST116") {
      return NextResponse.json(
        { error: "server_error", message: ministry.error.message },
        { status: 500, headers: NO_STORE }
      );
    }
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }
  const failed = roster.error ?? subcategories.error;
  if (failed) {
    return NextResponse.json(
      { error: "server_error", message: failed.message },
      { status: 500, headers: NO_STORE }
    );
  }

  return NextResponse.json(
    shapeDetail(ministry.data, roster.data ?? [], subcategories.data ?? [], access.canManage),
    { headers: NO_STORE }
  );
}
