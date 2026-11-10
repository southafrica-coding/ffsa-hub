import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Same gate as the other admin pages. Data still comes from the mock layer. */
export async function requireSignedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user;
}
