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
  ToggleLeft,
  type LucideIcon,
} from "lucide-react";
import {
  passesVisibilityGate,
  type ModuleVisibilityMap,
} from "@/lib/module-visibility";

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
    description: "Space bookings and vehicle reservations",
    requiredRoles: ["super_admin", "admin"], // others via bookings.* permissions
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
    description: "Fees, rent, support levels",
    requiredRoles: ["super_admin", "admin", "finance_admin"],
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
    description: "Historical CSVs of staff/student data — auto-linked to user profiles",
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
    id: "modules",
    label: "Modules",
    href: "/settings/modules",
    icon: ToggleLeft,
    description: "Switch modules on, off, or into super-admin-only beta",
    requiredRoles: ["super_admin"],
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
 * Returns modules the user can access.
 *
 * Two independent gates, applied in this order:
 *
 *   1. Rollout (module_visibility, migration 207) — is this module switched on
 *      for this person at all? A `beta` module is super-admin-only and a
 *      `hidden` one is off for everybody. Absent a map, everything is `live`.
 *   2. Access — the long-standing rule: super_admin and admin see everything,
 *      everyone else sees modules they hold a permission for.
 *
 * The rollout gate runs FIRST and is not something admin status overrides,
 * which is the whole point: a half-built module stays invisible even to the
 * roles that normally see everything.
 */
export function getAccessibleModules(
  modules: ModuleDefinition[],
  userRoles: string[],
  permittedModules?: Set<string>,
  visibility?: ModuleVisibilityMap
): ModuleDefinition[] {
  const isAdmin =
    userRoles.includes("super_admin") || userRoles.includes("admin");

  return modules.filter((mod) => {
    // 1. Rollout gate — applies to everyone, admins included.
    if (
      !UNGATEABLE_MODULE_IDS.has(mod.id) &&
      !passesVisibilityGate(mod.id, userRoles, visibility)
    ) {
      return false;
    }
    // 2. Access gate (unchanged).
    // Always open (dashboard, prayer room)
    if (mod.requiredRoles.length === 0) return true;
    // Admins see everything
    if (isAdmin) return true;
    // Otherwise check the permissions-based set
    return permittedModules?.has(mod.id) ?? false;
  });
}

/** Every module in one list — admin modules plus system modules. */
export const ALL_MODULES: ModuleDefinition[] = [
  ...ADMIN_MODULES,
  ...SYSTEM_MODULES,
];

/**
 * Which module does this pathname belong to?
 *
 * Longest href match wins, so /settings/slack resolves to the Slack module
 * rather than to Settings. Returns null for paths that belong to no module
 * (personal portal tabs, /profile, public pages) — those are never gated.
 */
/**
 * The rollout control panel itself is never gateable. Switching it off would
 * hide the only UI that can switch it back on — a self-inflicted lockout that
 * would need a SQL console to undo.
 */
export const UNGATEABLE_MODULE_IDS = new Set(["modules"]);

export function moduleForPathname(pathname: string): ModuleDefinition | null {
  let best: ModuleDefinition | null = null;
  for (const mod of ALL_MODULES) {
    const matches =
      pathname === mod.href || pathname.startsWith(`${mod.href}/`);
    if (matches && (!best || mod.href.length > best.href.length)) {
      best = mod;
    }
  }
  return best;
}
