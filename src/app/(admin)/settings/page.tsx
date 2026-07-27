import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerIsAdmin } from "@/lib/auth/check-ministry-access";
import { getAllListOptions } from "@/services/list-options";
import { SettingsLists } from "./settings-lists";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await callerIsAdmin(supabase, user.id))) redirect("/dashboard");

  const { data: lists } = await getAllListOptions(createAdminClient());

  return (
    <div className="space-y-6">
      <div>
        <p className="page-eyebrow">SYSTEM</p>
        <h1 className="page-title">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Edit the dropdown lists used across the Hub. Add, rename, reorder, or
          deactivate options — changes take effect everywhere immediately.
        </p>
      </div>
      <SettingsLists lists={lists ?? {}} />
    </div>
  );
}
