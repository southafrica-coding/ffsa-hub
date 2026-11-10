import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { accountIsActive } from "@/lib/auth/grant-scope";
import { loginPath } from "@/lib/departments/login-path";
import { createClient } from "@/lib/supabase/server";

/**
 * One session read per request. The department wrappers check the same
 * user again; this keeps our own active check from running twice.
 */
export const getViewer = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, active: false };
  const active = await accountIsActive(supabase, user.id);
  return { supabase, user, active };
});

/** Signed-in and active. A missing session goes to login. An inactive account is a 404. */
export async function requireSignedIn(currentPath = "") {
  const viewer = await getViewer();
  if (!viewer.user) redirect(loginPath(currentPath));
  if (!viewer.active) notFound();
  return viewer.user;
}
