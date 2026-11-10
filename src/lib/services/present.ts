// HubService cards for GET /api/services.
// Capability maps to UI role. Null-ministry open_to_all and any_point_leader
// rows set audience and are not owners.
// Evangelism moderators are not service_owners rows. can_moderate_evangelism
// covers Media and HULC, so those two slugs are emitted as moderator.

import type { ServiceCapability } from "@/lib/departments/db.types";
import type { HubService, ServiceAudience, ServiceDepartmentRole } from "@/lib/departments/ui-contract";
import { audienceFromGrants } from "./access";
import type { ServiceOwnerRow } from "./seed";

const ROLE: Record<ServiceCapability, ServiceDepartmentRole> = {
  own: "owner",
  manage: "manager",
  use: "access",
  moderate: "moderator",
};

const MODULE_ID: Record<string, string> = {
  gear_hire: "bookings",
  spaces: "bookings",
  vehicles: "bookings",
  communications: "communications",
  contacts: "contacts",
  evangelism: "evangelism",
  prayer_room: "prayer-room",
  brand_kit: "brand-kit",
};

export function toHubService(
  service: { service_key: string; label: string; admin_href: string },
  grants: readonly ServiceOwnerRow[],
  ministries: readonly { id: string; slug: string }[]
): HubService {
  const slugOf = new Map(ministries.map((ministry) => [ministry.id, ministry.slug]));
  const owners: HubService["owners"] = [];
  const seen = new Set<string>();
  for (const grant of grants) {
    if (grant.any_point_leader || grant.open_to_all === true || !grant.staff_ministry_id) continue;
    const slug = slugOf.get(grant.staff_ministry_id);
    if (!slug) continue;
    const role = ROLE[grant.capability];
    const key = `${slug}:${role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    owners.push({ slug, role });
  }
  if (service.service_key === "evangelism") {
    for (const slug of ["media", "hulk"]) {
      const key = `${slug}:moderator`;
      if (seen.has(key)) continue;
      seen.add(key);
      owners.push({ slug, role: "moderator" });
    }
  }
  owners.sort((a, b) => a.slug.localeCompare(b.slug) || a.role.localeCompare(b.role));
  return {
    id: service.service_key,
    name: service.label,
    summary: "",
    href: service.admin_href,
    moduleId: MODULE_ID[service.service_key] ?? "",
    owners,
    audience: audienceFromGrants(grants) satisfies ServiceAudience,
  };
}
