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
  SlidersHorizontal,
  Scale,
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
 * super_admin and admin see everything.
 * Everyone else sees only modules they have at least one permission for
 * (permittedModules is the set of module ids from user_permissions).
 */
export function getAccessibleModules(
  modules: ModuleDefinition[],
  userRoles: string[],
  permittedModules?: Set<string>
): ModuleDefinition[] {
  const isAdmin =
    userRoles.includes("super_admin") || userRoles.includes("admin");

  return modules.filter((mod) => {
    // Always open (dashboard, prayer room)
    if (mod.requiredRoles.length === 0) return true;
    // Admins see everything
    if (isAdmin) return true;
    // Otherwise check the permissions-based set
    return permittedModules?.has(mod.id) ?? false;
  });
}
