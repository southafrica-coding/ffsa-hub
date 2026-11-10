import { createClient } from "@/lib/supabase/server";
import { HubShell } from "@/components/hub-shell";
import { getSidebarAccess } from "@/lib/sidebar-access";
import { getUserInitials } from "@/lib/user-initials";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const [{ userRoles, permittedModules, menuLoadFailed }, initials] =
    await Promise.all([getSidebarAccess(supabase), getUserInitials(supabase)]);

  return (
    <HubShell
      userRoles={userRoles}
      permittedModules={permittedModules}
      menuLoadFailed={menuLoadFailed}
      initials={initials}
    >
      {children}
    </HubShell>
  );
}
