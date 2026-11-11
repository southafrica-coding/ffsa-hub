import "server-only";

// Access-checked reads for a signed-in viewer.
// Callers pass their user-session client. The service-role client is
// created here, after the access check, and is never a parameter.

import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api-auth";
import { accountIsActive } from "@/lib/auth/grant-scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadMinistryAccess } from "./access";
import { notAuthenticated, notAuthorized, notFound, serverError } from "./http";
import { resolveHome } from "./internal/open";
import { buildDepartmentHome, listVisibleDepartments, rocksDueFor, viewerMemberships } from "./internal/page";
import { listActiveMemberships, listDepartmentRows, listMinistriesById } from "./internal/repository";
import { usableServiceKeys } from "@/lib/services/access";
import { toHubService } from "@/lib/services/present";
import { listServiceOwnerRows, listServices } from "@/lib/services/internal/repository";
import type { DepartmentHome, DepartmentSummary, HomeDashboard, HubService } from "./ui-contract";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UserClient = any;

export type ViewerFailure =
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "error"; error?: unknown };

export type ViewerResult<T> = { kind: "ok"; data: T } | ViewerFailure;

export type DepartmentHomeResult = ViewerResult<DepartmentHome> | { kind: "redirect"; slug: string };

async function callerHasEquipmentAccess(userClient: UserClient): Promise<boolean> {
  const { data, error } = await userClient.rpc("has_equipment_access");
  if (error) return false;
  return data === true;
}

async function requireViewer(userClient: UserClient): Promise<{ userId: string } | ViewerFailure> {
  const user = await getAuthedUser(userClient);
  if (!user) return { kind: "unauthenticated" };
  if (!(await accountIsActive(userClient, user.id))) return { kind: "forbidden" };
  return { userId: user.id };
}

export function viewerResponse<T>(result: ViewerResult<T> | DepartmentHomeResult): NextResponse {
  switch (result.kind) {
    case "ok":
      return NextResponse.json(result.data);
    case "unauthenticated":
      return notAuthenticated();
    case "forbidden":
      return notAuthorized();
    case "not_found":
      return notFound("Department not found");
    case "redirect":
      return notFound("Department not found");
    case "error":
      return serverError(result.error);
  }
}

export async function loadDepartmentsIndexForViewer(userClient: UserClient): Promise<ViewerResult<DepartmentSummary[]>> {
  const viewer = await requireViewer(userClient);
  if ("kind" in viewer) return viewer;
  const list = await listVisibleDepartments(userClient);
  if (list.accessError) return { kind: "forbidden" };
  if (list.error || !list.data) return { kind: "error", error: list.error };
  return { kind: "ok", data: list.data };
}

/** donors_dev resolves to { kind: 'redirect', slug: 'finances_legal' } so a page can redirect. */
export async function loadDepartmentHomeForViewer(userClient: UserClient, slug: string): Promise<DepartmentHomeResult> {
  const viewer = await requireViewer(userClient);
  if ("kind" in viewer) return viewer;
  const found = await resolveHome(userClient, slug);
  if (found.error) return { kind: "forbidden" };
  if (!found.data) return { kind: "not_found" };
  if (found.data.slug !== slug) return { kind: "redirect", slug: found.data.slug };

  const decision = await loadMinistryAccess(userClient, found.data.id);
  if (!decision.ok) return { kind: "forbidden" };
  if (decision.denied) return { kind: "not_found" };

  const home = await buildDepartmentHome(
    createAdminClient(),
    userClient,
    viewer.userId,
    decision.access,
    found.data
  );
  if (home.error || !home.data) {
    if (home.error) return { kind: "error", error: home.error };
    return { kind: "not_found" };
  }
  return { kind: "ok", data: home.data };
}

export async function loadServicesForViewer(userClient: UserClient): Promise<ViewerResult<HubService[]>> {
  const viewer = await requireViewer(userClient);
  if ("kind" in viewer) return viewer;
  const [services, grants] = await Promise.all([listServices(userClient), listServiceOwnerRows(userClient)]);
  if (services.error || grants.error) return { kind: "forbidden" };
  const usable = await usableServiceKeys(
    userClient,
    services.data.map((service) => service.service_key)
  );
  if (!usable.ok) return { kind: "forbidden" };
  const visible = services.data.filter((service) => usable.keys.has(service.service_key));
  const [ministries, equipmentStaff] = await Promise.all([
    listMinistriesById(
      userClient,
      grants.data.flatMap((grant) => (grant.staff_ministry_id ? [grant.staff_ministry_id] : []))
    ),
    callerHasEquipmentAccess(userClient),
  ]);
  if (ministries.error) return { kind: "error", error: ministries.error };
  return {
    kind: "ok",
    data: visible
      .sort((a, b) => a.service_key.localeCompare(b.service_key))
      .map((service) =>
        toHubService(
          service,
          grants.data.filter((grant) => grant.service_key === service.service_key),
          ministries.data,
          equipmentStaff
        )
      ),
  };
}

export async function loadHomeForViewer(userClient: UserClient): Promise<ViewerResult<HomeDashboard>> {
  const viewer = await requireViewer(userClient);
  if ("kind" in viewer) return viewer;

  const [departments, services, grants, memberships] = await Promise.all([
    listVisibleDepartments(userClient),
    listServices(userClient),
    listServiceOwnerRows(userClient),
    listActiveMemberships(userClient, viewer.userId),
  ]);
  if (departments.accessError || memberships.error || services.error || grants.error) return { kind: "forbidden" };
  if (departments.error || !departments.data) return { kind: "error", error: departments.error };
  const usable = await usableServiceKeys(
    userClient,
    services.data.map((service) => service.service_key)
  );
  if (!usable.ok) return { kind: "forbidden" };

  const admin = createAdminClient();
  const rows = await listDepartmentRows(admin);
  if (rows.error) return { kind: "error", error: rows.error };
  const openSlugs = new Set(departments.data.filter((home) => home.access.canSeeDepartmentDetail).map((home) => home.slug));
  const homes = rows.data.filter((row) => openSlugs.has(row.slug));
  const due = await rocksDueFor(admin, homes, new Set(homes.map((home) => home.id)));
  if (due.error || !due.data) return { kind: "error", error: due.error };

  const visible = services.data.filter((service) => usable.keys.has(service.service_key));
  const [ministries, equipmentStaff] = await Promise.all([
    listMinistriesById(
      userClient,
      grants.data.flatMap((grant) => (grant.staff_ministry_id ? [grant.staff_ministry_id] : []))
    ),
    callerHasEquipmentAccess(userClient),
  ]);
  if (ministries.error) return { kind: "error", error: ministries.error };

  return {
    kind: "ok",
    data: {
      departments: departments.data,
      services: visible
        .sort((a, b) => a.service_key.localeCompare(b.service_key))
        .map((service) =>
          toHubService(
            service,
            grants.data.filter((grant) => grant.service_key === service.service_key),
            ministries.data,
            equipmentStaff
          )
        ),
      rocksDue: due.data,
      okrCheckInsDue: [],
      viewerMemberships: viewerMemberships(memberships.data, rows.data),
    },
  };
}
