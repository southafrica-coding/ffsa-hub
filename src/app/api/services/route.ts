import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api-auth";
import { accountIsActive } from "@/lib/auth/grant-scope";
import { notAuthenticated, notAuthorized, serverError } from "@/lib/departments/http";
import { listServiceOwnership } from "@/lib/services/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// GET /api/services
// Every service_key, the ministries that own it, and admin_href.
// Any active signed-in user. Inactive and a failed active-check are 403.
// The rows are read with the service role after that check: service_owners
// is configuration, and it may not be granted to the session yet.

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return notAuthenticated();
  if (!(await accountIsActive(supabase, user.id))) return notAuthorized();

  const services = await listServiceOwnership(createAdminClient());
  if (services.error) return serverError(services.error.message);
  return NextResponse.json({ services: services.data });
}
