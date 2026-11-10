import "server-only";
import { notFound, redirect } from "next/navigation";
import { getAuthedUser } from "@/lib/api-auth";
import { accountIsActive } from "@/lib/auth/grant-scope";
import { loadMinistryAccess } from "@/lib/departments/access";
import { resolveHome } from "@/lib/departments/http";
import { loginPath } from "@/lib/departments/login-path";
import {
  buildDepartmentHome,
  listVisibleDepartments,
  rocksDueFor,
  viewerMemberships,
} from "@/lib/departments/page";
import { listActiveMemberships, listDepartmentRows, listMinistriesById } from "@/lib/departments/repository";
import { usableServiceKeys } from "@/lib/services/access";
import { toHubService } from "@/lib/services/present";
import { listServiceOwnerRows, listServices } from "@/lib/services/repository";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { DepartmentHome, DepartmentSummary, HomeDashboard, HubService } from "@/lib/departments/ui-contract";

/**
 * Calls the exported department loaders with the signed-in user's server client.
 * Outcome mapping matches the route handlers: no user → login, inactive or a
 * failed access lookup → not found, a missing home → not found, any other
 * failure throws before a partial payload is returned.
 *
 * buildDepartmentHome, listDepartmentRows and rocksDueFor are given the admin
 * client, which is the client those route handlers pass for those reads.
 */
export class DepartmentLoadError extends Error {
  constructor(message = "Department data failed") {
    super(message);
    this.name = "DepartmentLoadError";
  }
}

async function openSession(currentPath: string) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) redirect(loginPath(currentPath));
  if (!(await accountIsActive(supabase, user.id))) notFound();
  return { supabase, user };
}

export async function loadDepartmentList(currentPath: string): Promise<DepartmentSummary[]> {
  const { supabase } = await openSession(currentPath);
  const list = await listVisibleDepartments(supabase);
  if (list.accessError) notFound();
  if (list.error || !list.data) throw new DepartmentLoadError(list.error?.message);
  return list.data;
}

export async function loadDepartmentHome(slug: string, currentPath: string): Promise<DepartmentHome> {
  const { supabase, user } = await openSession(currentPath);
  const found = await resolveHome(supabase, slug);
  if (found.error) notFound();
  if (!found.data) notFound();
  const decision = await loadMinistryAccess(supabase, found.data.id);
  if (!decision.ok || decision.denied) notFound();
  const home = await buildDepartmentHome(
    createAdminClient(),
    supabase,
    user.id,
    decision.access,
    found.data
  );
  if (home.error) throw new DepartmentLoadError(home.error.message);
  if (!home.data) notFound();
  return home.data;
}

export async function loadHubServices(currentPath: string): Promise<HubService[]> {
  const { supabase } = await openSession(currentPath);
  const [services, grants] = await Promise.all([listServices(supabase), listServiceOwnerRows(supabase)]);
  if (services.error || grants.error) notFound();
  const usable = await usableServiceKeys(
    supabase,
    services.data.map((service) => service.service_key)
  );
  if (!usable.ok) notFound();
  const visible = services.data.filter((service) => usable.keys.has(service.service_key));
  const ministries = await listMinistriesById(
    supabase,
    grants.data.flatMap((grant) => (grant.staff_ministry_id ? [grant.staff_ministry_id] : []))
  );
  if (ministries.error) throw new DepartmentLoadError(ministries.error.message);
  return visible
    .sort((a, b) => a.service_key.localeCompare(b.service_key))
    .map((service) =>
      toHubService(
        service,
        grants.data.filter((grant) => grant.service_key === service.service_key),
        ministries.data
      )
    );
}

export async function loadHomeDashboard(currentPath: string): Promise<HomeDashboard> {
  const { supabase, user } = await openSession(currentPath);
  const [departments, services, grants, memberships] = await Promise.all([
    listVisibleDepartments(supabase),
    listServices(supabase),
    listServiceOwnerRows(supabase),
    listActiveMemberships(supabase, user.id),
  ]);
  if (departments.accessError || memberships.error || services.error || grants.error) notFound();
  if (departments.error || !departments.data) throw new DepartmentLoadError(departments.error?.message);
  const usable = await usableServiceKeys(
    supabase,
    services.data.map((service) => service.service_key)
  );
  if (!usable.ok) notFound();

  const admin = createAdminClient();
  const rows = await listDepartmentRows(admin);
  if (rows.error) throw new DepartmentLoadError(rows.error.message);
  const openSlugs = new Set(
    departments.data.filter((home) => home.access.canSeeDepartmentDetail).map((home) => home.slug)
  );
  const homes = rows.data.filter((row) => openSlugs.has(row.slug));
  const due = await rocksDueFor(admin, homes, new Set(homes.map((home) => home.id)));
  if (due.error || !due.data) throw new DepartmentLoadError(due.error?.message);

  const visible = services.data.filter((service) => usable.keys.has(service.service_key));
  const ministries = await listMinistriesById(
    supabase,
    grants.data.flatMap((grant) => (grant.staff_ministry_id ? [grant.staff_ministry_id] : []))
  );
  if (ministries.error) throw new DepartmentLoadError(ministries.error.message);

  return {
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
  };
}
