import { HubShell } from "@/components/hub-shell";
import { departmentsForShell, sessionClient } from "@/lib/departments/load";
import { getSidebarAccess } from "@/lib/sidebar-access";
import { getUserInitials } from "@/lib/user-initials";
import { hasEquipmentAccess } from "@/services/equipment";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await sessionClient();
  const [{ userRoles, permittedModules, menuLoadFailed }, initials, equipmentStaff, departments] =
    await Promise.all([
      getSidebarAccess(supabase),
      getUserInitials(supabase),
      hasEquipmentAccess(supabase).catch(() => false),
      departmentsForShell(supabase),
    ]);

  return (
    <HubShell
      userRoles={userRoles}
      permittedModules={permittedModules}
      menuLoadFailed={menuLoadFailed}
      initials={initials}
      departments={departments}
      equipmentStaff={equipmentStaff}
      variant="portal"
    >
      {children}
    </HubShell>
  );
}
