// service_owners reads. The only `.from("service_owners")` in the app.
// TODO(hub-data): column names are assumed — see src/lib/departments/types.ts.

import { dbError } from "@/lib/departments/repository";
import {
  SERVICE_OWNERS_TABLE,
  type DbResult,
  type ServiceCapability,
  type ServiceOwnerRow,
} from "@/lib/departments/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const COLUMNS =
  "id, service_key, staff_ministry_id, capability, member_role, any_point_leader, admin_href";

const CAPABILITIES = new Set<ServiceCapability>(["manage", "use", "moderate", "own"]);

/** Drop a row we cannot trust. A bad capability must not become an allow. */
export function serviceOwnerRows(data: unknown): ServiceOwnerRow[] {
  if (!Array.isArray(data)) return [];
  const rows: ServiceOwnerRow[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<ServiceOwnerRow>;
    if (typeof row.service_key !== "string" || row.service_key === "") continue;
    if (typeof row.capability !== "string" || !CAPABILITIES.has(row.capability)) continue;
    if (row.member_role !== "member" && row.member_role !== "leader") continue;
    rows.push({
      id: typeof row.id === "string" ? row.id : "",
      service_key: row.service_key,
      staff_ministry_id: typeof row.staff_ministry_id === "string" ? row.staff_ministry_id : null,
      capability: row.capability,
      member_role: row.member_role,
      any_point_leader: row.any_point_leader === true,
      admin_href: typeof row.admin_href === "string" ? row.admin_href : null,
    });
  }
  return rows;
}

export async function listServiceOwnerRows(
  supabase: Client,
  serviceKey?: string
): Promise<DbResult<ServiceOwnerRow[]>> {
  let query = supabase.from(SERVICE_OWNERS_TABLE).select(COLUMNS);
  if (serviceKey) query = query.eq("service_key", serviceKey);
  const { data, error } = await query;
  if (error) return { data: [], error: dbError(error) ?? { message: "Request failed" } };
  return { data: serviceOwnerRows(data), error: null };
}
