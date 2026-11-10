import { cookies } from "next/headers";
import { AdminSidebar } from "@/components/admin-sidebar";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { ProfileCompletionGate } from "@/components/profile-completion-gate";
import { AutoRefresh } from "@/components/auto-refresh";
import { BackButton } from "@/components/back-button";
import { AssistantMount } from "@/components/assistant/assistant-mount";

/** One shell for the staff admin and the personal portal. */
export async function HubShell({
  children,
  userRoles,
  permittedModules,
  menuLoadFailed,
  initials,
  departments,
}: {
  children: React.ReactNode;
  userRoles: string[];
  permittedModules?: Set<string>;
  menuLoadFailed?: boolean;
  initials?: string;
  departments?: { id: string; label: string; href: string }[];
}) {
  const collapsed = (await cookies()).get("ffsa-sidebar")?.value === "1";
  return (
    <div className="flex h-screen overflow-hidden bg-bg text-ink">
      <AdminSidebar
        userRoles={userRoles}
        permittedModules={permittedModules}
        menuLoadFailed={menuLoadFailed}
        initials={initials}
        departments={departments}
        defaultCollapsed={collapsed}
      />
      <main data-shell-main className="min-w-0 flex-1 overflow-y-auto bg-bg pb-20 pt-14 md:pb-0 md:pt-0">
        <div className="animate-fade-up">
          <div data-shell-topbar className="mx-auto max-w-6xl empty:hidden">
            <AutoRefresh />
            <BackButton />
          </div>
          <ProfileCompletionGate>{children}</ProfileCompletionGate>
        </div>
      </main>
      <MobileTabBar showDepartments={(departments?.length ?? 0) > 0} />
      <AssistantMount userRoles={userRoles} />
    </div>
  );
}
