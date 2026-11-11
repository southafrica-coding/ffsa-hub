// Test fixture matching the service_owners seed. Runtime reads the table.
// open_to_all rows are capability use only (service_owners_open_to_all_use_ck).
// own does not imply manage: owners are seeded with both.

import type { ServiceCapability, ServiceOwner } from "@/lib/departments/db.types";

export type ServiceSeedRow = {
  service_key: string;
  ministry_slug: string | null;
  capability: ServiceCapability;
  member_role: "member" | "leader" | null;
  any_point_leader: boolean;
    open_to_all: boolean;
  admin_href: string;
};

export const SERVICE_CATALOG: ReadonlyArray<{ service_key: string; label: string; admin_href: string }> = [
  { service_key: "gear_hire", label: "Gear hire", admin_href: "/bookings/equipment" },
  { service_key: "communications", label: "Communications", admin_href: "/communications" },
  { service_key: "contacts", label: "Contacts", admin_href: "/contacts" },
  { service_key: "evangelism", label: "Evangelism", admin_href: "/evangelism" },
  { service_key: "prayer_room", label: "Prayer room", admin_href: "/prayer-room" },
  { service_key: "spaces", label: "Spaces", admin_href: "/bookings/spaces" },
  { service_key: "vehicles", label: "Vehicles", admin_href: "/bookings/vehicles" },
  { service_key: "brand_kit", label: "Brand kit", admin_href: "/brand-kit" },
];

const href = Object.fromEntries(SERVICE_CATALOG.map((row) => [row.service_key, row.admin_href]));

function row(
  serviceKey: string,
  ministrySlug: string | null,
  capability: ServiceCapability,
  memberRole: "member" | "leader" | null,
  flags: { any_point_leader?: boolean; open_to_all?: boolean } = {}
): ServiceSeedRow {
  const openToAll = flags.open_to_all === true;
  if (openToAll && capability !== "use") {
    throw new Error("open_to_all rows are use-only");
  }
  return {
    service_key: serviceKey,
    ministry_slug: ministrySlug,
    capability,
    member_role: memberRole,
    any_point_leader: flags.any_point_leader === true,
    open_to_all: openToAll,
    admin_href: href[serviceKey] ?? "",
  };
}

/** staff_ministry_id null, capability use, open_to_all true.
 * adminHref overrides the service's staff door. Gear hire's open row
 * is the public storefront; the register stays on the service row.
 */
function openToAll(serviceKey: string, adminHref?: string): ServiceSeedRow {
  const seeded = row(serviceKey, null, "use", null, { open_to_all: true });
  if (adminHref) seeded.admin_href = adminHref;
  return seeded;
}

function owned(serviceKey: string, ministrySlug: string): ServiceSeedRow[] {
  return [row(serviceKey, ministrySlug, "own", "member"), row(serviceKey, ministrySlug, "manage", "member")];
}

export const SERVICE_OWNER_SEED: readonly ServiceSeedRow[] = [
  ...owned("gear_hire", "prayer_and_worship"),
  ...owned("gear_hire", "operations"),
  ...owned("gear_hire", "media"),
  openToAll("gear_hire", "/hire"),
  ...owned("communications", "media"),
  row("communications", "hulk", "use", "member"),
  row("communications", "leadership_team", "use", "member"),
  ...owned("contacts", "media"),
  ...owned("contacts", "hulk"),
  ...owned("contacts", "leadership_team"),
  row("contacts", null, "use", "leader", { any_point_leader: true }),
  row("evangelism", "media", "own", "member"),
  row("evangelism", "hulk", "own", "member"),
  openToAll("evangelism"),
  ...owned("prayer_room", "prayer_and_worship"),
  openToAll("prayer_room"),
  ...owned("spaces", "operations"),
  openToAll("spaces"),
  ...owned("vehicles", "operations"),
  openToAll("vehicles"),
  ...owned("brand_kit", "media"),
];

export type ServiceOwnerRow = ServiceOwner;

export function seedGrants(ids: Record<string, string>): ServiceOwnerRow[] {
  return SERVICE_OWNER_SEED.map((row, index) => {
    let staffMinistryId: string | null = null;
    if (row.ministry_slug) {
      const id = ids[row.ministry_slug];
      if (!id) throw new Error(`No ministry id for slug ${row.ministry_slug}`);
      staffMinistryId = id;
    }
    return {
      id: `seed-${index}`,
      service_key: row.service_key,
      staff_ministry_id: staffMinistryId,
      capability: row.capability,
      member_role: row.member_role,
      any_point_leader: row.any_point_leader,
      open_to_all: row.open_to_all,
      admin_href: row.admin_href,
      created_at: "2026-11-10T00:00:00.000Z",
    };
  });
}
