import {
  Building2,
  Car,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  Package,
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

export type ShellNav = {
  home: ShellLink | null;
  inbox: ShellLink | null;
  services: ShellLink[];
  /** Empty until a caller passes the viewer's departments. The group stays hidden. */
  departments: ShellLink[];
  work: ShellLink[];
  system: ShellLink[];
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
  options?: { equipmentStaff?: boolean }
): ShellNav {
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
    label: tab.label,
    href: tab.href,
    icon: tab.icon,
  }));
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
    me,
  };
}

export function flattenShellNav(nav: ShellNav): ShellLink[] {
  return [
    ...(nav.home ? [nav.home] : []),
    ...(nav.inbox ? [nav.inbox] : []),
    ...nav.services,
    ...nav.departments,
    ...nav.work,
    ...nav.system,
    ...nav.me,
  ];
}
