import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // `/` is not a return path. Signed-in people go straight to Home.
  // Anonymous visitors reach login with nothing to come back to.
  redirect(user ? "/home" : "/login");
}
