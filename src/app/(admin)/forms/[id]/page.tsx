import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getFormById } from "@/services/forms";
import { canManageHubForms } from "@/lib/auth/hub-forms-access";
import { emptyFormSchema, type FormSchema } from "@/lib/forms/schema";
import { FormBuilder } from "@/components/forms/form-builder";
import { accessModeOf } from "@/components/forms/describe";

// /forms/[id] — the builder for a Hub form. An event form opens in its
// event instead, behind the event's own gate.
export default async function HubFormBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: form, error } = await getFormById(supabase, id);
  if (error || !form) notFound();
  if (form.event_id) redirect(`/events/${form.event_id}/forms/${form.id}`);
  if (!(await canManageHubForms(supabase, user.id))) redirect("/dashboard");

  const schema: FormSchema =
    form.schema && typeof form.schema === "object" && "steps" in form.schema
      ? (form.schema as unknown as FormSchema)
      : emptyFormSchema();

  return (
    <div className="ffsa-screen">
      <FormBuilder
        backHref="/forms"
        backLabel="Forms"
        responsesHref={`/forms/${form.id}/responses`}
        form={{
          id: form.id,
          name: form.name,
          slug: form.slug,
          is_active: form.is_active,
          records_attendance: form.records_attendance,
          label_id: form.label_id,
          access_mode: accessModeOf((form as { access_mode?: unknown }).access_mode),
          kind: (form as { kind?: string | null }).kind ?? null,
        }}
        initialSchema={schema}
      />
    </div>
  );
}
