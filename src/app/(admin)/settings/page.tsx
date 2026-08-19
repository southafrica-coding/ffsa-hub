import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerIsAdmin } from "@/lib/auth/check-ministry-access";
import { getAllListOptions } from "@/services/list-options";
import { SettingsLists } from "./settings-lists";
import { Masthead } from "@/components/ffsa";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await callerIsAdmin(supabase, user.id))) redirect("/dashboard");

  const { data: lists } = await getAllListOptions(createAdminClient());

  return (
    <div className="ffsa-screen">
      <Masthead context="System" title="Settings" />
      <div className="space-y-6 px-5 py-6 md:px-8">
          <p className="max-w-2xl text-sm text-[#55524A]">
            Edit the dropdown lists used across the Hub. Add, rename, reorder, or
            deactivate options — changes take effect everywhere immediately.
          </p>
        <SettingsLists lists={lists ?? {}} />
      </div>
    </div>
  );
}
