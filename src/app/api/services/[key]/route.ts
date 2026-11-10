import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api-auth";
import { accountIsActive } from "@/lib/auth/grant-scope";
import { notAuthenticated, notAuthorized, notFound, serverError } from "@/lib/departments/http";
import { getServiceOwners } from "@/lib/services/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// GET /api/services/[key]
// One service's owning ministries and admin_href.
// Any active signed-in user. Unknown key 404. Inactive 403.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return notAuthenticated();
  if (!(await accountIsActive(supabase, user.id))) return notAuthorized();
  if (!/^[a-z0-9_]+$/.test(key)) return notFound("Service not found");

  const owners = await getServiceOwners(createAdminClient(), key);
  if (owners.error) return serverError(owners.error.message);
  if (!owners.data) return notFound("Service not found");
  return NextResponse.json(owners.data);
}
