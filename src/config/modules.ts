import {
  LayoutDashboard,
  Users,
  Calendar,
  GraduationCap,
  UsersRound,
  Wallet,
  Mail,
  Globe,
  UserCog,
  Shield,
  Heart,
  HeartHandshake,
  Archive,
  History,
  Building2,
  Network,
  Palette,
  MessageSquare,
  SlidersHorizontal,
  Scale,
  Target,
  Megaphone,
  UserCheck,
  Car,
  type LucideIcon,
} from "lucide-react";

export interface ModuleDefinition {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
  /** Role names that grant access. Empty array = any authenticated user. */
  requiredRoles: string[];
}

export interface PortalTab {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

/** Admin modules — visible only if the user has at least one of requiredRoles. */
export const ADMIN_MODULES: ModuleDefinition[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    description: "Overview and stats",
    requiredRoles: [], // any authenticated user
  },
  {
    id: "contacts",
    label: "Contacts",
    href: "/contacts",
    icon: Users,
    description: "CRM directory and marketing contacts",
    requiredRoles: ["super_admin", "admin", "staff"],
  },
  {
    id: "communications",
    label: "Communications",
    href: "/communications",
    icon: Mail,
    description: "Announcements and partner updates",
    requiredRoles: ["super_admin", "admin", "comms_admin"],
  },
  {
    id: "events",
    label: "Events",
    href: "/events",
    icon: Calendar,
    description: "Events, registrations, and attendance",
    requiredRoles: ["super_admin", "admin", "events_admin"],
  },
  {
    id: "bookings",
    label: "Bookings",
    href: "/bookings",
    icon: Building2,
    description: "Space bookings, vehicle reservations and equipment hire",
    requiredRoles: ["super_admin", "admin"], // others via bookings.* permissions
  },
  {
    // Vehicle inspections, km and workshop visits (vehicles-module/HUB-PLAN.md).
    // Shown to admins and to anyone with a fleet.* permission (the Vehicle
    // Coordinator role), not to everyone who can book a vehicle.
    id: "fleet",
    label: "Fleet",
    href: "/bookings/vehicles/fleet",
    icon: Car,
    description: "Vehicle inspections, km readings and workshop visits",
    requiredRoles: ["super_admin", "admin"], // others via fleet.* permissions
  },
  {
    id: "schools",
    label: "Training",
    href: "/schools",
    icon: GraduationCap,
    description: "DTS, DBS, SBS, and other programs",
    requiredRoles: ["super_admin", "admin", "program_leader"],
  },
  {
    id: "teams",
    label: "Teams",
    href: "/teams",
    icon: UsersRound,
    description: "Ministry and outreach teams",
    requiredRoles: ["super_admin", "admin", "team_leader"],
  },
  {
    id: "org-chart",
    label: "Org Chart",
    href: "/org-chart",
    icon: Network,
    description: "Interactive map of FFSA's organisational structure",
    requiredRoles: ["super_admin", "admin"], // others via the org.view permission — gated until the module is dialed in
  },
  {
    id: "finance",
    label: "Finance",
    href: "/finance",
    icon: Wallet,
    description: "Outreach budgets, fees, rent, support levels",
    // Open to everyone: anyone can run an outreach budget. The Finance page
    // shows the other finance modules only to finance staff.
    requiredRoles: [],
  },
  {
    id: "prayer-room",
    label: "Prayer Room",
    href: "/prayer-room",
    icon: Heart,
    description: "Weekly devo schedule, rosters, directory, and team applications",
    requiredRoles: [], // visible to ALL authenticated users
  },
  {
    id: "mission",
    label: "Mission",
    href: "/mission",
    icon: Globe,
    description: "Outreach trips and impact stats",
    requiredRoles: ["super_admin", "admin", "mission_leader"],
  },
  {
    id: "ministry",
    label: "Ministries",
    href: "/ministry",
    icon: HeartHandshake,
    description: "Ministries and their staff teams",
    requiredRoles: ["super_admin", "admin", "ministry_leader"],
  },
  {
    id: "okrs",
    label: "OKRs",
    href: "/okrs",
    icon: Target,
    description: "Ministry objectives and key results, with a dated check-in history",
    requiredRoles: [], // ministry OKRs are meant to be seen by the whole base
  },
  {
    id: "staff-decisions",
    label: "Staff decisions",
    href: "/staff-decisions",
    icon: UserCheck,
    description: "Leadership Track: who is accepted onto staff",
    requiredRoles: ["leadership_team"], // role-only (+ super_admin) — see ROLE_ONLY_MODULES
  },
  {
    id: "brand-kit",
    label: "Brand Kit",
    href: "/brand-kit",
    icon: Palette,
    description: "The FFSA brand — palette, type, logos, voice. Drives emails and event pages",
    requiredRoles: ["super_admin", "admin"], // gated by the 'brand_kit.view' permission (module 'brand-kit')
  },
  {
    id: "records-library",
    label: "Records Library",
    href: "/records-library",
    icon: Archive,
    description:
      "Historical CSVs of staff/student data — auto-linked to user profiles. Super admin only (or a records_library.manage grant)",
    requiredRoles: ["super_admin"],
  },
  {
    id: "evangelism",
    label: "Evangelism",
    href: "/evangelism",
    icon: Megaphone,
    description:
      "Staff share testimonies; publishers approve or withhold them. Admins, or any evangelism.* permission",
    requiredRoles: ["super_admin", "admin"],
  },
];

/** System management modules — shown at the bottom of the sidebar. */
export const SYSTEM_MODULES: ModuleDefinition[] = [
  {
    id: "users",
    label: "Users",
    href: "/users",
    icon: UserCog,
    description: "Manage login accounts",
    requiredRoles: ["super_admin", "admin"],
  },
  {
    id: "legal",
    label: "Legal",
    href: "/consents",
    icon: Scale,
    description: "Who signed which policy",
    requiredRoles: ["super_admin", "admin", "legal_admin"],
  },
  {
    id: "roles",
    label: "Roles",
    href: "/roles",
    icon: Shield,
    description: "Role definitions",
    requiredRoles: ["super_admin"],
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    icon: SlidersHorizontal,
    description: "Editable dropdown lists",
    requiredRoles: ["super_admin", "admin"],
  },
  {
    id: "slack",
    label: "Slack",
    href: "/settings/slack",
    icon: MessageSquare,
    description: "Who the Hub can message",
    requiredRoles: ["super_admin", "admin"],
  },
];

/** Personal portal tabs — always visible to any logged-in user. */
export const PORTAL_TABS: PortalTab[] = [
  {
    id: "profile",
    label: "Profile",
    href: "/profile",
    icon: Users,
  },
  {
    id: "my-events",
    label: "My Events",
    href: "/my-events",
    icon: Calendar,
  },
  {
    id: "my-finance",
    label: "Finance",
    href: "/my-finance",
    icon: Wallet,
  },
  {
    id: "my-schools",
    label: "Training",
    href: "/my-schools",
    icon: GraduationCap,
  },
  {
    id: "my-mission",
    label: "Mission",
    href: "/my-mission",
    icon: Globe,
  },
  {
    id: "my-history",
    label: "History",
    href: "/my-history",
    icon: History,
  },
];

/**
 * Modules the blanket super_admin/admin bypass does NOT cover.
 *
 * The `admin` role ("general admin") is otherwise identical to super_admin.
 * The Records Library is the one carve-out: it holds historical CSVs of
 * personal data, so it takes super_admin or an explicit
 * `records_library.manage` grant (direct or via a job title's bundle).
 *
 * Mirrors public.can_access_records_library() in migration 212. It is the
 * ONLY difference between super_admin and admin — keep it that way.
 */
export const SUPER_ADMIN_ONLY_MODULES = new Set(["records-library"]);

/**
 * Modules shown by role alone — admins don't get them for free and no
 * permission grant unlocks them. Staff decisions (migration 247) are for the
 * Leadership Team, plus super_admin — a plain `admin` does not get them.
 */
export const ROLE_ONLY_MODULES: Record<string, string> = {
  "staff-decisions": "leadership_team",
};

/**
 * Pages that are still only a "Not built yet" placeholder. They stay
 * out of every menu for every role (admins included) so nobody lands on an
 * empty page; a direct visit redirects to the dashboard. The pages and their
 * permissions are kept — delete an id here once its page is real.
 */
export const HIDDEN_FROM_NAV = new Set(["teams", "mission", "my-mission"]);

/** True for a placeholder page that should not be reachable yet. */
export function isHiddenFromNav(id: string): boolean {
  return HIDDEN_FROM_NAV.has(id);
}

/** The personal tabs shown in navigation (placeholders left out). */
export function getVisiblePortalTabs(tabs: PortalTab[] = PORTAL_TABS): PortalTab[] {
  return tabs.filter((t) => !HIDDEN_FROM_NAV.has(t.id));
}

/**
 * Returns modules the user can access.
 *
 * HIDDEN_FROM_NAV placeholders are never returned. Otherwise:
 * super_admin sees everything. `admin` sees everything except the modules in
 * SUPER_ADMIN_ONLY_MODULES, which fall through to the permission check.
 * Everyone else sees only modules they have at least one permission for
 * (permittedModules is the set of module ids from user_permissions).
 */
export function getAccessibleModules(
  modules: ModuleDefinition[],
  userRoles: string[],
  permittedModules?: Set<string>
): ModuleDefinition[] {
  const isSuperAdmin = userRoles.includes("super_admin");
  const isAdmin = isSuperAdmin || userRoles.includes("admin");

  return modules.filter((mod) => {
    // Unbuilt placeholders are hidden from everyone, super_admin included.
    if (HIDDEN_FROM_NAV.has(mod.id)) return false;
    const onlyRole = ROLE_ONLY_MODULES[mod.id];
    if (onlyRole) return isSuperAdmin || userRoles.includes(onlyRole);
    // Always open (dashboard, prayer room)
    if (mod.requiredRoles.length === 0) return true;
    // Admins see everything — except the super-admin-only carve-outs
    if (isAdmin && !(!isSuperAdmin && SUPER_ADMIN_ONLY_MODULES.has(mod.id))) {
      return true;
    }
    // Otherwise check the permissions-based set
    return permittedModules?.has(mod.id) ?? false;
  });
}
