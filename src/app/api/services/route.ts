import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api-auth";
import { accountIsActive } from "@/lib/auth/grant-scope";
import { holdsUnscopedRole } from "@/lib/departments/access";
import { notAuthenticated, notAuthorized, serverError } from "@/lib/departments/http";
import { listMinistriesById, listUserRoleGrants } from "@/lib/departments/repository";
import { canUseService } from "@/lib/services/access";
import { toHubService } from "@/lib/services/present";
import { listServiceOwnerRows, listServices } from "@/lib/services/repository";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// GET /api/services — bare HubService[]. Serializer shapes are provisional.

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return notAuthenticated();
  if (!(await accountIsActive(supabase, user.id))) return notAuthorized();
  const admin = createAdminClient();
  const [services, grants, roles] = await Promise.all([
    listServices(admin),
    listServiceOwnerRows(admin),
    listUserRoleGrants(supabase, user.id),
  ]);
  if (services.error || grants.error || roles.error) return serverError(services.error ?? grants.error ?? roles.error);
  const adminUser = holdsUnscopedRole(roles.data, ["super_admin", "admin"]);
  const visible = [];
  for (const service of services.data) {
    if (adminUser || (await canUseService(supabase, user.id, service.service_key))) visible.push(service);
  }
  const ministries = await listMinistriesById(
    admin,
    grants.data.flatMap((grant) => (grant.staff_ministry_id ? [grant.staff_ministry_id] : []))
  );
  if (ministries.error) return serverError(ministries.error);
  return NextResponse.json(
    visible
      .sort((a, b) => a.service_key.localeCompare(b.service_key))
      .map((service) =>
        toHubService(
          service,
          grants.data.filter((grant) => grant.service_key === service.service_key),
          ministries.data
        )
      )
  );
}
