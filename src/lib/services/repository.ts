// Reads public.services and public.service_owners (migration 318).
// Column names come from src/lib/departments/db.types.ts.
// If the relation is not there yet, the seed fixture is the fallback.
// Any other lookup error stays an error so callers fail closed.

import type { Service, ServiceCapability } from "@/lib/departments/db.types";
import { dbError, relationMissing, type DbError, type DbResult } from "@/lib/departments/repository";
import { seedGrants, SERVICE_CATALOG, SERVICE_OWNER_SEED, type ServiceOwnerRow } from "./seed";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const OWNER_COLUMNS =
  "id, service_key, staff_ministry_id, capability, member_role, any_point_leader, open_to_all, admin_href, created_at";

const CAPABILITIES = new Set<ServiceCapability>(["manage", "use", "moderate", "own"]);

export function serviceOwnerRows(data: unknown): ServiceOwnerRow[] {
  if (!Array.isArray(data)) return [];
  const rows: ServiceOwnerRow[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<ServiceOwnerRow>;
    if (typeof row.service_key !== "string" || row.service_key === "") continue;
    if (typeof row.capability !== "string" || !CAPABILITIES.has(row.capability)) continue;
    if (row.member_role != null && row.member_role !== "member" && row.member_role !== "leader") continue;
    rows.push({
      id: typeof row.id === "string" ? row.id : "",
      service_key: row.service_key,
      staff_ministry_id: typeof row.staff_ministry_id === "string" ? row.staff_ministry_id : null,
      capability: row.capability,
      member_role: row.member_role ?? null,
      any_point_leader: row.any_point_leader === true,
      open_to_all: row.open_to_all === true,
      admin_href: typeof row.admin_href === "string" ? row.admin_href : null,
      created_at: typeof row.created_at === "string" ? row.created_at : "",
    });
  }
  return rows;
}

function seedOwners(): ServiceOwnerRow[] {
  const ids: Record<string, string> = {};
  for (const row of SERVICE_OWNER_SEED) {
    if (row.ministry_slug) ids[row.ministry_slug] = `slug:${row.ministry_slug}`;
  }
  return seedGrants(ids);
}

export async function listServiceOwnerRows(supabase: Client, serviceKey?: string): Promise<DbResult<ServiceOwnerRow[]>> {
  let query = supabase.from("service_owners").select(OWNER_COLUMNS);
  if (serviceKey) query = query.eq("service_key", serviceKey);
  const { data, error } = await query;
  const parsed = dbError(error);
  if (parsed) {
    if (relationMissing(parsed)) {
      const rows = seedOwners().filter((row) => !serviceKey || row.service_key === serviceKey);
      return { data: rows, error: null };
    }
    return { data: [], error: parsed };
  }
  return { data: serviceOwnerRows(data), error: null };
}

export async function listServices(supabase: Client): Promise<DbResult<Service[]>> {
  const { data, error } = await supabase.from("services").select("service_key, label, admin_href, created_at");
  const parsed = dbError(error);
  if (parsed) {
    if (relationMissing(parsed)) {
      return {
        data: SERVICE_CATALOG.map((row) => ({ ...row, created_at: "" })),
        error: null,
      };
    }
    return { data: [], error: parsed };
  }
  const rows = (Array.isArray(data) ? data : []) as Service[];
  return { data: rows.filter((row) => typeof row.service_key === "string"), error: null };
}

export type { DbError };
