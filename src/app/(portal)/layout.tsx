import { createClient } from "@/lib/supabase/server";
import { AdminSidebar } from "@/components/admin-sidebar";
import { ProfileCompletionGate } from "@/components/profile-completion-gate";
import { AutoRefresh } from "@/components/auto-refresh";
import { BackButton } from "@/components/back-button";
import { getSidebarAccess } from "@/lib/sidebar-access";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { userRoles, permittedModules, menuLoadFailed } =
    await getSidebarAccess(supabase);

  return (
    <div className="flex h-screen overflow-hidden">
      <AdminSidebar
        userRoles={userRoles}
        permittedModules={permittedModules}
        menuLoadFailed={menuLoadFailed}
      />
      <main className="flex-1 overflow-y-auto bg-muted/30">
        <div className="mx-auto max-w-4xl px-6 py-8">
          <AutoRefresh />
          <BackButton />
          <ProfileCompletionGate>{children}</ProfileCompletionGate>
        </div>
      </main>
    </div>
  );
}
