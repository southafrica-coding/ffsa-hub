import { HubShell } from "@/components/hub-shell";
import { departmentsForShell } from "@/lib/departments/load";
import { getSidebarAccess } from "@/lib/sidebar-access";
import { getUserInitials } from "@/lib/user-initials";
import { getRequestViewer } from "@/lib/viewer-cache";
import { hasEquipmentAccess } from "@/services/equipment";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await getRequestViewer();
  const supabase = viewer.supabase;
  const known = viewer.user ? { userId: viewer.user.id, active: viewer.active } : undefined;
  const [{ userRoles, roleNames, permittedModules, staffSignals, menuLoadFailed }, initials, equipmentStaff, departments] =
    await Promise.all([
      getSidebarAccess(supabase, known),
      getUserInitials(supabase, viewer.user ?? undefined),
      hasEquipmentAccess(supabase).catch(() => false),
      departmentsForShell(supabase),
    ]);

  return (
    <HubShell
      userRoles={userRoles}
      roleNames={roleNames}
      staffSignals={staffSignals}
      permittedModules={permittedModules}
      menuLoadFailed={menuLoadFailed}
      initials={initials}
      departments={departments}
      equipmentStaff={equipmentStaff}
      variant="staff"
    >
      {children}
    </HubShell>
  );
}
