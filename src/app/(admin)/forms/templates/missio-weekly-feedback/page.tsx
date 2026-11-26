import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageHubForms } from "@/lib/auth/hub-forms-access";
import { TemplatePreview } from "@/components/forms/template-preview";
import {
  MISSIO_WEEKLY_FEEDBACK_NAME,
  MISSIO_WEEKLY_FEEDBACK_SLUG,
  missioWeeklyFeedbackSchema,
} from "@/lib/forms/templates/missio-weekly-feedback";

// /forms/templates/missio-weekly-feedback — the weekly feedback template,
// read only, before (or after) the ops script seeds it.
export default async function MissioWeeklyTemplatePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await canManageHubForms(supabase, user.id))) redirect("/dashboard");

  const { data } = await supabase.from("forms").select("id").eq("slug", MISSIO_WEEKLY_FEEDBACK_SLUG).maybeSingle();
  return (
    <TemplatePreview
      name={MISSIO_WEEKLY_FEEDBACK_NAME}
      note="Filled once per house church each week, from the house's link or the house page. Marlon's questions, plus a first-timer name only when the leader opts in, and optional prayer to the Care board."
      schema={missioWeeklyFeedbackSchema()}
      seeded={data ? { id: (data as { id: string }).id } : null}
    />
  );
}
