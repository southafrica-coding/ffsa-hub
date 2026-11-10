import { AdminSidebar } from "@/components/admin-sidebar";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { ProfileCompletionGate } from "@/components/profile-completion-gate";
import { AutoRefresh } from "@/components/auto-refresh";
import { BackButton } from "@/components/back-button";
import { AssistantMount } from "@/components/assistant/assistant-mount";

/** One shell for the staff admin and the personal portal. */
export function HubShell({
  children,
  userRoles,
  permittedModules,
  menuLoadFailed,
  initials,
}: {
  children: React.ReactNode;
  userRoles: string[];
  permittedModules?: Set<string>;
  menuLoadFailed?: boolean;
  initials?: string;
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-bg text-ink">
      <AdminSidebar
        userRoles={userRoles}
        permittedModules={permittedModules}
        menuLoadFailed={menuLoadFailed}
        initials={initials}
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
      <MobileTabBar />
      <AssistantMount userRoles={userRoles} />
    </div>
  );
}
