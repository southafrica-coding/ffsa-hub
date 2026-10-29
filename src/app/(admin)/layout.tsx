import { createClient } from "@/lib/supabase/server";
import { AdminSidebar } from "@/components/admin-sidebar";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { ProfileCompletionGate } from "@/components/profile-completion-gate";
import { AutoRefresh } from "@/components/auto-refresh";
import { BackButton } from "@/components/back-button";
import { getSidebarAccess } from "@/lib/sidebar-access";
import { getUserInitials } from "@/lib/user-initials";
import { AssistantMount } from "@/components/assistant/assistant-mount";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const [{ userRoles, permittedModules, menuLoadFailed }, initials] =
    await Promise.all([getSidebarAccess(supabase), getUserInitials(supabase)]);

  return (
    <div className="flex h-screen overflow-hidden">
      <AdminSidebar
        userRoles={userRoles}
        permittedModules={permittedModules}
        menuLoadFailed={menuLoadFailed}
        initials={initials}
      />
      {/* pb-20 on phones keeps the last row clear of the frame-4d tab bar. */}
      <main data-shell-main className="flex-1 overflow-y-auto bg-background pb-20 pt-14 md:pb-0 md:pt-0">
        <div className="animate-fade-up">
          <div data-shell-topbar className="mx-auto max-w-6xl px-4 md:px-6 pt-6 md:pt-8">
            <AutoRefresh />
            <BackButton />
          </div>
          <ProfileCompletionGate>{children}</ProfileCompletionGate>
        </div>
      </main>
      <MobileTabBar />
      <AssistantMount userRoles={userRoles} />
    </div>
  );
}
