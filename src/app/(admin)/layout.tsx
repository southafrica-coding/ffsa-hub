import { createClient } from "@/lib/supabase/server";
import { AdminSidebar } from "@/components/admin-sidebar";
import { ProfileCompletionGate } from "@/components/profile-completion-gate";
import { AutoRefresh } from "@/components/auto-refresh";
import { BackButton } from "@/components/back-button";
import { getSidebarAccess } from "@/lib/sidebar-access";

export default async function AdminLayout({
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
      <main className="flex-1 overflow-y-auto bg-background pt-14 md:pt-0">
        <div className="mx-auto max-w-6xl px-4 md:px-6 py-6 md:py-8 animate-fade-up">
          <AutoRefresh />
          <BackButton />
          <ProfileCompletionGate>{children}</ProfileCompletionGate>
        </div>
      </main>
    </div>
  );
}
