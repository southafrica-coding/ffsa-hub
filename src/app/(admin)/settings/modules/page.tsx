import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerIsSuperAdmin } from "@/lib/auth/check-role-grant";
import { getModuleVisibilityRows } from "@/lib/module-visibility";
import { ALL_MODULES, UNGATEABLE_MODULE_IDS } from "@/config/modules";
import { Masthead } from "@/components/ffsa";
import { ModuleVisibilityTable, type ModuleRow } from "./module-visibility-table";

export default async function ModuleVisibilityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // super_admin only — plain `admin` cannot switch modules on and off, for the
  // same reason plain `admin` cannot see a beta module.
  if (!(await callerIsSuperAdmin(supabase, user.id))) redirect("/dashboard");

  const stored = await getModuleVisibilityRows(createAdminClient());
  const byKey = new Map(stored.map((r) => [r.key, r]));

  // Drive the list off the CODE, not the table: a module added since the last
  // migration has no row yet and must still appear here (defaulting to live).
  const rows: ModuleRow[] = ALL_MODULES.filter(
    (mod) => !UNGATEABLE_MODULE_IDS.has(mod.id)
  ).map((mod) => ({
    key: mod.id,
    label: mod.label,
    href: mod.href,
    description: mod.description,
    visibility: byKey.get(mod.id)?.visibility ?? "live",
    note: byKey.get(mod.id)?.note ?? "",
  }));

  return (
    <div className="ffsa-screen">
      <Masthead context="System" title="Modules" />

      <p className="max-w-3xl border-b border-rule px-5 py-4 text-[14px] leading-relaxed text-[color:var(--text-secondary)] md:px-8">
        Control which modules are switched on for the Hub. Use{" "}
        <strong>Beta</strong> while you are still building something — it stays
        invisible to everyone except super admins, in the menu and on the page
        itself. <strong>Off</strong> hides it from everybody. Nothing here
        replaces permissions: a <strong>Live</strong> module still follows the
        normal role and permission rules.
      </p>

      <div className="px-5 py-6 md:px-8 md:py-7">
        <ModuleVisibilityTable rows={rows} />
      </div>
    </div>
  );
}
