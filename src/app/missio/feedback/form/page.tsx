import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isMissioPastorUser } from "@/lib/auth/hub-forms-access";
import { getMissioWeeklyFeedbackForm } from "@/services/forms";
import { accessModeOf } from "@/components/forms/describe";
import type { FormSchema } from "@/lib/forms/schema";
import { MissioFeedbackFormEditor, type MissioWeeklyFormView } from "@/components/missio/feedback/form-editor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Feedback form · Missio" },
};

/**
 * /missio/feedback/form — the weekly feedback form's questions, for Missio
 * pastors. Only this one form (kind missio_weekly_feedback) opens here;
 * /forms stays with Hub admins and comms_admin. Saving goes through
 * /api/forms/[id], which lets a pastor change only this form's name and
 * questions. Nothing is created or seeded here: no row, no editor.
 */
export default async function MissioFeedbackFormPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const pastor = await isMissioPastorUser(supabase);
  let form: MissioWeeklyFormView | null = null;
  if (pastor) {
    const { data } = await getMissioWeeklyFeedbackForm(supabase);
    const row = data as Record<string, unknown> | null;
    const schema = row?.schema as FormSchema | null | undefined;
    if (row && row.is_active === true && schema && typeof schema === "object" && Array.isArray(schema.steps)) {
      form = {
        id: String(row.id),
        name: String(row.name),
        slug: String(row.slug),
        is_active: true,
        records_attendance: row.records_attendance === true,
        label_id: (row.label_id as string | null) ?? null,
        access_mode: accessModeOf(row.access_mode),
        kind: typeof row.kind === "string" ? row.kind : null,
        schema,
      };
    }
  }

  return <MissioFeedbackFormEditor pastor={pastor} form={form} />;
}
