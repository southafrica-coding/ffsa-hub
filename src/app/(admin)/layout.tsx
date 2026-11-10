import { createClient } from "@/lib/supabase/server";
import { HubShell } from "@/components/hub-shell";
import { getSidebarAccess } from "@/lib/sidebar-access";
import { getUserInitials } from "@/lib/user-initials";
import { hasEquipmentAccess } from "@/services/equipment";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const [{ userRoles, permittedModules, menuLoadFailed }, initials, equipmentStaff] =
    await Promise.all([
      getSidebarAccess(supabase),
      getUserInitials(supabase),
      hasEquipmentAccess(supabase).catch(() => false),
    ]);

  return (
    <HubShell
      userRoles={userRoles}
      permittedModules={permittedModules}
      menuLoadFailed={menuLoadFailed}
      initials={initials}
      departments={[]}
      equipmentStaff={equipmentStaff}
      variant="staff"
    >
      {children}
    </HubShell>
  );
}
