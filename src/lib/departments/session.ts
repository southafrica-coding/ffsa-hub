import { notFound, redirect } from "next/navigation";
import { accountIsActive } from "@/lib/auth/grant-scope";
import { loginPath } from "@/lib/departments/login-path";
import { createClient } from "@/lib/supabase/server";

/** Signed-in and active. A missing session goes to login. An inactive account is a 404. */
export async function requireSignedIn(currentPath = "") {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(loginPath(currentPath));
  if (!(await accountIsActive(supabase, user.id))) notFound();
  return user;
}
