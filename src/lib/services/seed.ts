// The service-ownership rules, as data.
//
// Helpers never switch on a ministry name. They read service_owners rows.
// This fixture is the set those rows should hold once Hub Data's migration
// lands — tests assert the rules against it, and the INSERT can be copied
// from it. Slugs are staff_ministries.slug on main:
//   Leadership Team → leadership_team
//   HULC (spoken of as Hulk) → hulk
//   Prayer & Worship → prayer_and_worship
//   Finances & Legal → finances_legal
//
// capability 'own' is the ownership lookup only. It does not grant manage,
// use or moderate. 'manage' implies 'use'. 'moderate' does not imply either.

import type { MemberRole, ServiceCapability, ServiceOwnerRow } from "@/lib/departments/types";

export type ServiceOwnerSeed = {
  service_key: string;
  ministry_slug: string | null;
  capability: ServiceCapability;
  member_role: MemberRole;
  any_point_leader: boolean;
  admin_href: string;
};

export const SERVICE_KEYS = {
  communications: "communications",
  contacts: "contacts",
  evangelism: "evangelism",
  gearHire: "gear_hire",
} as const;

export const SERVICE_OWNER_SEED: readonly ServiceOwnerSeed[] = [
  // Communications: Media, HULC and Leadership can manage.
  seed("communications", "media", "manage", "/communications"),
  seed("communications", "hulk", "manage", "/communications"),
  seed("communications", "leadership_team", "manage", "/communications"),

  // Contacts: those three run it. Every ministry leader can use it.
  seed("contacts", "media", "manage", "/contacts"),
  seed("contacts", "hulk", "manage", "/contacts"),
  seed("contacts", "leadership_team", "manage", "/contacts"),
  {
    service_key: "contacts",
    ministry_slug: null,
    capability: "use",
    member_role: "leader",
    any_point_leader: true,
    admin_href: "/contacts",
  },

  // Evangelism: Media and HULC moderate.
  seed("evangelism", "media", "moderate", "/evangelism"),
  seed("evangelism", "hulk", "moderate", "/evangelism"),

  // Gear hire: owned jointly by Prayer & Worship, Operations and Media.
  // Ownership is its own capability — it does not by itself grant manage.
  seed("gear_hire", "prayer_and_worship", "own", "/bookings/equipment/gear"),
  seed("gear_hire", "operations", "own", "/bookings/equipment/gear"),
  seed("gear_hire", "media", "own", "/bookings/equipment/gear"),
];

function seed(
  serviceKey: string,
  ministrySlug: string,
  capability: ServiceCapability,
  adminHref: string
): ServiceOwnerSeed {
  return {
    service_key: serviceKey,
    ministry_slug: ministrySlug,
    capability,
    member_role: "member",
    any_point_leader: false,
    admin_href: adminHref,
  };
}

/** Resolve slugs to ministry ids so a test can run the real matcher. */
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
      admin_href: row.admin_href,
    };
  });
}
