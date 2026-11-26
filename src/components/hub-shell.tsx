import { cookies } from "next/headers";
import { AdminSidebar } from "@/components/admin-sidebar";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { shellVariantForRoles, type StaffSignals } from "@/components/shell-nav";
import { ProfileCompletionGate } from "@/components/profile-completion-gate";
import { AutoRefresh } from "@/components/auto-refresh";
import { BackButton } from "@/components/back-button";
import { AssistantMount } from "@/components/assistant/assistant-mount";
import { ThemeSync } from "@/lib/theme/theme-sync";
import type { ColorScheme } from "@/lib/theme";

/** One shell for the staff admin and the personal portal. */
export async function HubShell({
  children,
  userRoles,
  permittedModules,
  menuLoadFailed,
  initials,
  colorScheme = null,
  departments = [],
  roleNames,
  staffSignals,
  equipmentStaff = false,
  variant = "staff",
}: {
  children: React.ReactNode;
  userRoles: string[];
  permittedModules?: Set<string>;
  menuLoadFailed?: boolean;
  initials?: string;
  /** Saved Light / Dark setting (users.color_scheme). Null follows the device. */
  colorScheme?: ColorScheme | null;
  /** Empty until the department API is wired. A non-empty list shows the tab and group. */
  departments?: { id: string; label: string; href: string }[];
  /** Every role name, including scoped ones. Falls back to the unscoped list. */
  roleNames?: string[];
  /** Staff-only access. Portal-role bundles are not included. */
  staffSignals?: StaffSignals;
  /** True when has_equipment_access() is true. Hire gear then opens the staff register. */
  equipmentStaff?: boolean;
  /**
   * Used only when the role list failed to load. A loaded list wins, so a
   * portal-only person on /home does not inherit the staff route's chrome.
   */
  variant?: "staff" | "portal";
}) {
  const collapsed = (await cookies()).get("ffsa-sidebar")?.value === "1";
  const resolvedVariant = menuLoadFailed
    ? variant
    : shellVariantForRoles(roleNames ?? userRoles, { departments, staffSignals });
  return (
    <div className="flex h-screen overflow-hidden bg-bg text-ink">
      <ThemeSync scheme={colorScheme} />
      <AdminSidebar
        userRoles={userRoles}
        permittedModules={permittedModules}
        menuLoadFailed={menuLoadFailed}
        initials={initials}
        departments={departments}
        equipmentStaff={equipmentStaff}
        variant={resolvedVariant}
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
      <MobileTabBar showDepartments={(departments?.length ?? 0) > 0} variant={resolvedVariant} />
      <AssistantMount userRoles={userRoles} />
    </div>
  );
}
