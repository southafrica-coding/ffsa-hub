import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/require-permission";
import { getStoreStaffLevel } from "@/lib/store/access";

// Every /store/admin page: signed in, Store module access (admins, or a
// store.* grant), then the finer manage/view level for what to show.
export async function storeAdminGuard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/store/admin");
  await requireModuleAccess(supabase, user.id, "store");
  const level = await getStoreStaffLevel(supabase, user.id);
  if (!level) redirect("/dashboard");
  return { supabase, userId: user.id, canManage: level === "manage" };
}
