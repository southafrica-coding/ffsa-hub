import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listAllForms } from "@/services/forms";
import { canManageHubForms } from "@/lib/auth/hub-forms-access";
import { FormsLibrary, toFormListRow } from "@/components/forms/forms-library";

// /forms — every form in the Hub: Hub forms built here, and event forms
// (which still open in their event). Admin or comms_admin only, the same
// rule as /api/forms/[id] for forms with no event.
export default async function FormsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await canManageHubForms(supabase, user.id))) redirect("/dashboard");

  const { data, error } = await listAllForms(supabase);
  const rows = ((data ?? []) as unknown[]).map(toFormListRow);

  return <FormsLibrary rows={rows} loadError={error?.message ?? null} />;
}
