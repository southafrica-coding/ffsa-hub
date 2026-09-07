import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminSidebar } from "@/components/admin-sidebar";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { ProfileCompletionGate } from "@/components/profile-completion-gate";
import { AutoRefresh } from "@/components/auto-refresh";
import { BackButton } from "@/components/back-button";
import { getSidebarAccess } from "@/lib/sidebar-access";
import { getUserInitials } from "@/lib/user-initials";
import {
  getModuleVisibility,
  passesVisibilityGate,
  visibilityOf,
} from "@/lib/module-visibility";
import { moduleForPathname, UNGATEABLE_MODULE_IDS } from "@/config/modules";
import { BetaModuleBanner } from "@/components/beta-module-banner";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const [{ userRoles, permittedModules, menuLoadFailed }, initials, moduleVisibility] =
    await Promise.all([
      getSidebarAccess(supabase),
      getUserInitials(supabase),
      getModuleVisibility(supabase),
    ]);

  // Rollout gate on the ROUTE, not just the nav. Hiding the sidebar link is
  // not hiding the module — someone with the URL (or an old bookmark) would
  // walk straight in. Doing it here covers every admin page at once, so a
  // module added later cannot forget the check.
  const pathname = (await headers()).get("x-pathname") ?? "";
  const currentModule = moduleForPathname(pathname);
  if (
    currentModule &&
    !UNGATEABLE_MODULE_IDS.has(currentModule.id) &&
    !passesVisibilityGate(currentModule.id, userRoles, moduleVisibility)
  ) {
    notFound();
  }
  const currentVisibility = currentModule
    ? visibilityOf(currentModule.id, moduleVisibility)
    : "live";

  return (
    <div className="flex h-screen overflow-hidden">
      <AdminSidebar
        userRoles={userRoles}
        permittedModules={permittedModules}
        menuLoadFailed={menuLoadFailed}
        initials={initials}
        moduleVisibility={moduleVisibility}
      />
      {/* pb-20 on phones keeps the last row clear of the frame-4d tab bar. */}
      <main className="flex-1 overflow-y-auto bg-background pb-20 pt-14 md:pb-0 md:pt-0">
        <div className="animate-fade-up">
          <div className="mx-auto max-w-6xl px-4 md:px-6 pt-6 md:pt-8">
            <AutoRefresh />
            <BackButton />
          </div>
          {currentVisibility !== "live" && currentModule && (
            <div className="mx-auto max-w-6xl px-4 md:px-6">
              <BetaModuleBanner
                label={currentModule.label}
                visibility={currentVisibility}
              />
            </div>
          )}
          <ProfileCompletionGate>{children}</ProfileCompletionGate>
        </div>
      </main>
      <MobileTabBar />
    </div>
  );
}
