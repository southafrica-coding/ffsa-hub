import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api-auth";
import { accountIsActive } from "@/lib/auth/grant-scope";
import { notAuthenticated, notAuthorized, serverError } from "@/lib/departments/http";
import { listVisibleDepartments, rocksDueFor, viewerMemberships } from "@/lib/departments/page";
import { listActiveMemberships, listDepartmentRows, listMinistriesById } from "@/lib/departments/repository";
import { usableServiceKeys } from "@/lib/services/access";
import { toHubService } from "@/lib/services/present";
import { listServiceOwnerRows, listServices } from "@/lib/services/repository";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// GET /api/me/home. okrCheckInsDue is empty: there is no due-check-in table.

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return notAuthenticated();
  if (!(await accountIsActive(supabase, user.id))) return notAuthorized();

  const [departments, services, grants, memberships] = await Promise.all([
    listVisibleDepartments(supabase, user.id),
    listServices(supabase),
    listServiceOwnerRows(supabase),
    listActiveMemberships(supabase, user.id),
  ]);
  if (departments.accessError || memberships.error) return notAuthorized();
  if (departments.error || services.error || grants.error) {
    return serverError(departments.error ?? services.error ?? grants.error);
  }
  const usable = await usableServiceKeys(
    supabase,
    services.data.map((service) => service.service_key)
  );
  if (!usable.ok) return notAuthorized();

  const admin = createAdminClient();
  const rows = await listDepartmentRows(admin);
  if (rows.error) return serverError(rows.error);
  const openSlugs = new Set(
    (departments.data ?? []).filter((home) => home.access.canSeeDepartmentDetail).map((home) => home.slug)
  );
  const homes = rows.data.filter((row) => openSlugs.has(row.slug));
  const due = await rocksDueFor(admin, homes, new Set(homes.map((home) => home.id)));
  if (due.error) return serverError(due.error);

  const visible = services.data.filter((service) => usable.keys.has(service.service_key));
  const ministries = await listMinistriesById(
    supabase,
    grants.data.flatMap((grant) => (grant.staff_ministry_id ? [grant.staff_ministry_id] : []))
  );
  if (ministries.error) return serverError(ministries.error);

  return NextResponse.json({
    departments: departments.data,
    services: visible
      .sort((a, b) => a.service_key.localeCompare(b.service_key))
      .map((service) =>
        toHubService(
          service,
          grants.data.filter((grant) => grant.service_key === service.service_key),
          ministries.data
        )
      ),
    rocksDue: due.data,
    okrCheckInsDue: [],
    viewerMemberships: viewerMemberships(memberships.data, rows.data),
  });
}
