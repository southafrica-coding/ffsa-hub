import "server-only";
import { cache } from "react";
import { accountIsActive } from "@/lib/auth/grant-scope";
import { createClient } from "@/lib/supabase/server";

/**
 * One signed-in viewer per request. Layouts and pages share this, so
 * auth.getUser and the users.is_active read happen once.
 */
export const getRequestViewer = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, active: false };
  const active = await accountIsActive(supabase, user.id);
  return { supabase, user, active };
});
