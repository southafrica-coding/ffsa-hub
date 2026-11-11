import {
  Building2,
  Car,
  GraduationCap,
  Heart,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  Package,
  User,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  ADMIN_MODULES,
  SYSTEM_MODULES,
  getAccessibleModules,
  getVisiblePortalTabs,
  type ModuleDefinition,
} from "@/config/modules";

export type ShellLink = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
};

export type ShellVariant = "staff" | "portal";

/**
 * Membership roles. Their own permission bundles do not make someone staff.
 * A viewer is staff only for a staff signal: another role (scoped or not),
 * a direct unscoped grant, a staff-role bundle, schools or program-staff
 * access, or a department.
 */
const MEMBERSHIP_ONLY_ROLES = new Set(["student", "community_member", "self_service"]);

export type StaffSignals = {
  directUnscopedGrant: boolean;
  staffRoleBundle: boolean;
  schoolsStaff: boolean;
};

export function shellVariantForRoles(
  userRoles: readonly string[],
  options?: {
    departments?: readonly unknown[] | null;
    staffSignals?: StaffSignals | null;
  }
): ShellVariant {
  const staffRole = userRoles.some((role) => !MEMBERSHIP_ONLY_ROLES.has(role));
  const signals = options?.staffSignals;
  const staff =
    staffRole ||
    (options?.departments?.length ?? 0) > 0 ||
    !!signals?.directUnscopedGrant ||
    !!signals?.staffRoleBundle ||
    !!signals?.schoolsStaff;
  return staff ? "staff" : "portal";
}

/**
 * Portal phone tabs and the portal desktop sidebar. One label per href:
 * Finance is personal fees, not the staff office.
 */
export const PORTAL_SHELL_LINKS: ShellLink[] = [
  { id: "school", label: "School", href: "/my-schools", icon: GraduationCap },
  { id: "finance", label: "Finance", href: "/my-finance", icon: Wallet },
  { id: "prayer", label: "Prayer", href: "/prayer-room", icon: Heart },
  { id: "portal-me", label: "Me", href: "/profile", icon: User },
];

export type ShellNav = {
  home: ShellLink | null;
  inbox: ShellLink | null;
  services: ShellLink[];
  /** Empty until a caller passes the viewer's departments. The group stays hidden. */
  departments: ShellLink[];
  work: ShellLink[];
  system: ShellLink[];
  /** Portal primary items. Empty on the staff shell. */
  portalLinks: ShellLink[];
  me: ShellLink[];
};

function fromModule(mod: ModuleDefinition, label = mod.label): ShellLink {
  return { id: mod.id, label, href: mod.href, icon: mod.icon };
}

/**
 * Every live module, regrouped. Hidden placeholders stay out. A destination
 * the viewer cannot access is omitted. Nothing the viewer can open today is
 * dropped — it moves into Services, Work tools, System, or the avatar menu.
 */
export function buildShellNav(
  userRoles: string[],
  permittedModules?: Set<string>,
  departments: ShellLink[] = [],
  options?: { equipmentStaff?: boolean; variant?: ShellVariant }
): ShellNav {
  if (options?.variant === "portal") return portalShell();
  const admin = getAccessibleModules(ADMIN_MODULES, userRoles, permittedModules);
  const system = getAccessibleModules(SYSTEM_MODULES, userRoles, permittedModules);
  const byId = new Map(admin.map((mod) => [mod.id, mod]));

  const services: ShellLink[] = [
    { id: "all-services", label: "All services", href: "/services", icon: LayoutGrid },
  ];
  const prayer = byId.get("prayer-room");
  if (prayer) services.push(fromModule(prayer, "Prayer room"));
  services.push({
    id: "hire-gear",
    label: "Hire gear",
    href: options?.equipmentStaff ? "/bookings/equipment" : "/hire",
    icon: Package,
  });
  if (byId.has("bookings")) {
    services.push(
      { id: "book-space", label: "Book a space", href: "/bookings/spaces", icon: Building2 },
      { id: "hire-vehicle", label: "Hire a vehicle", href: "/bookings/vehicles", icon: Car }
    );
  }
  const training = byId.get("schools");
  if (training) services.push(fromModule(training, "Training"));
  const events = byId.get("events");
  if (events) services.push(fromModule(events, "Events"));
  const evangelism = byId.get("evangelism");
  if (evangelism) services.push(fromModule(evangelism, "Evangelism"));

  const workOrder = [
    // The widget board, kept so staff can still open it. It is not the front door,
    // and it is not in the nav because a denied module used to land here.
    "dashboard",
    "contacts",
    "communications",
    "brand-kit",
    "finance",
    "bookings",
    "org-chart",
    "staff-decisions",
    "records-library",
    "ministry",
    "okrs",
  ];
  const work = workOrder.flatMap((id) => {
    const mod = byId.get(id);
    return mod ? [fromModule(mod)] : [];
  });

  const communications = byId.get("communications");
  const inbox = communications
    ? { id: "inbox", label: "Inbox", href: "/communications/inbox", icon: Inbox }
    : null;

  const home: ShellLink = {
    id: "home",
    label: "Home",
    href: "/home",
    icon: byId.get("dashboard")?.icon ?? LayoutDashboard,
  };

  const me = getVisiblePortalTabs().map((tab) => ({
    id: tab.id,
    label: tab.href === "/my-finance" ? "My finance" : tab.label,
    href: tab.href,
    icon: tab.icon,
  }));
  // Staff Finance is the office at /finance, only when that module is open.
  // Personal fees stay in the avatar as My finance.
  const finance = byId.get("finance");
  if (finance) me.push(fromModule(finance, "Finance"));
  me.push({
    id: "security",
    label: "Security",
    href: "/account/security",
    icon: KeyRound,
  });

  return {
    home,
    inbox,
    services,
    departments,
    work,
    system: system.map((mod) => fromModule(mod)),
    portalLinks: [],
    me,
  };
}

/** Personal tabs only. Staff groups stay empty so the office never appears here. */
function portalShell(): ShellNav {
  const extras = getVisiblePortalTabs()
    .filter((tab) => !PORTAL_SHELL_LINKS.some((link) => link.href === tab.href))
    .map((tab) => ({
      id: tab.id,
      label: tab.label,
      href: tab.href,
      icon: tab.icon,
    }));
  extras.push({
    id: "security",
    label: "Security",
    href: "/account/security",
    icon: KeyRound,
  });
  return {
    home: null,
    inbox: null,
    services: [],
    departments: [],
    work: [],
    system: [],
    portalLinks: PORTAL_SHELL_LINKS,
    me: [...PORTAL_SHELL_LINKS, ...extras],
  };
}

export function flattenShellNav(nav: ShellNav): ShellLink[] {
  const links = [
    ...(nav.home ? [nav.home] : []),
    ...(nav.inbox ? [nav.inbox] : []),
    ...nav.services,
    ...nav.departments,
    ...nav.work,
    ...nav.system,
    ...nav.portalLinks,
    ...nav.me,
  ];
  return links.filter(
    (link, index) => links.findIndex((item) => item.href === link.href && item.label === link.label) === index
  );
}
