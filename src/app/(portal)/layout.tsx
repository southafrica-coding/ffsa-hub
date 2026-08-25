import { createClient } from "@/lib/supabase/server";
import { AdminSidebar } from "@/components/admin-sidebar";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { ProfileCompletionGate } from "@/components/profile-completion-gate";
import { AutoRefresh } from "@/components/auto-refresh";
import { BackButton } from "@/components/back-button";
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
    <div className="flex h-screen overflow-hidden">
      <AdminSidebar
        userRoles={userRoles}
        permittedModules={permittedModules}
        menuLoadFailed={menuLoadFailed}
        initials={initials}
      />
      {/*
        Frame 4d: recomposed portal screens run edge-to-edge, bringing their
        own Masthead rather than sitting in a centred box. pb-20 on phones
        keeps the last row clear of the bottom tab bar.

        The `admin-content` class is the SAME transition scaffold the admin
        shell uses (globals.css): it re-applies the old centred, padded page
        box to any root child not marked `.ffsa-screen`. The portal needs it
        because four of its screens — profile, my-schools/[enrollmentId],
        my-schools/apply/[programId], my-finance/outreach/[teamId] — are not
        recomposed yet, and without it they render flush to the rail with no
        gutters. Drop the class here when those four are done.
      */}
      <main className="admin-content flex-1 overflow-y-auto bg-white pb-20 pt-14 md:pb-0 md:pt-0">
        <div className="px-5 pt-5 md:px-8 md:pt-6">
          <AutoRefresh />
          <BackButton />
        </div>
        <ProfileCompletionGate>{children}</ProfileCompletionGate>
      </main>
      <MobileTabBar />
    </div>
  );
}
