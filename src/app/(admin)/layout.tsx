import { createClient } from "@/lib/supabase/server";
import { AdminSidebar } from "@/components/admin-sidebar";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { ProfileCompletionGate } from "@/components/profile-completion-gate";
import { AutoRefresh } from "@/components/auto-refresh";
import { BackButton } from "@/components/back-button";
import { getSidebarAccess } from "@/lib/sidebar-access";
import { getUserInitials } from "@/lib/user-initials";

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
      <main className="flex-1 overflow-y-auto bg-background pb-20 pt-14 md:pb-0 md:pt-0">
        {/*
          Redesign transition: migrated screens render edge-to-edge (their own
          Masthead spans the full workspace). Screens not yet recomposed keep
          the old centred, padded page box — `.admin-content` in globals.css
          applies it to any root child that isn't marked `.ffsa-screen`.
          When every screen is migrated, drop the rule and this comment.
        */}
        <div className="admin-content animate-fade-up">
          <div className="mx-auto max-w-6xl px-4 md:px-6 pt-6 md:pt-8">
            <AutoRefresh />
            <BackButton />
          </div>
          <ProfileCompletionGate>{children}</ProfileCompletionGate>
        </div>
      </main>
      <MobileTabBar />
    </div>
  );
}
