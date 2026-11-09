import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";

/**
 * Evangelism stays in HIDDEN_FROM_NAV, so the sidebar does not list it.
 * These pages are real, so a direct visit is allowed for someone who can
 * open the module (admin today; an evangelism.* grant once that key exists).
 * The old placeholder redirected every visit to the dashboard — don't put
 * that back while the screens are here.
 */
export async function requireEvangelismPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "evangelism");
  return user;
}
