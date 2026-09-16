import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerIsAdmin } from "@/lib/auth/check-ministry-access";
import { getAllListOptions } from "@/services/list-options";
import { SettingsLists } from "./settings-lists";
import { GoogleCalendarConnection } from "./google-calendar-connection";
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

      <p className="max-w-3xl border-b border-rule px-5 py-4 text-[14px] leading-relaxed text-[color:var(--text-secondary)] md:px-8">
        Edit the dropdown lists used across the Hub. Add, rename, reorder or
        deactivate options — changes take effect everywhere immediately.
      </p>

      <div className="space-y-8 px-5 py-6 md:px-8 md:py-7">
        <Suspense>
          <GoogleCalendarConnection />
        </Suspense>

        <SettingsLists lists={lists ?? {}} />
      </div>
    </div>
  );
}
