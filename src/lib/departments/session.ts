import { notFound, redirect } from "next/navigation";
import { accountIsActive } from "@/lib/auth/grant-scope";
import { createClient } from "@/lib/supabase/server";

/** Signed-in and active. A missing session goes to login. An inactive account is a 404. */
export async function requireSignedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await accountIsActive(supabase, user.id))) notFound();
  return user;
}
