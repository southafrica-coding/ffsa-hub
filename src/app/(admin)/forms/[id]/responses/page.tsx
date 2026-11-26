import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getFormById, listFormSubmissions } from "@/services/forms";
import { canManageHubForms } from "@/lib/auth/hub-forms-access";
import type { FormSchema } from "@/lib/forms/schema";
import { Masthead } from "@/components/ffsa";
import { FormResponsesList, responseFields } from "@/components/forms/form-responses";

// /forms/[id]/responses — every submission to a Hub form. The same list
// the event responses page shows.
export default async function HubFormResponsesPage({
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
  if (form.event_id) redirect(`/events/${form.event_id}/forms/${form.id}/responses`);
  if (!(await canManageHubForms(supabase, user.id))) redirect("/dashboard");

  const { data: submissions } = await listFormSubmissions(supabase, id);
  const schema: FormSchema | null =
    form.schema && typeof form.schema === "object" && "steps" in form.schema
      ? (form.schema as unknown as FormSchema)
      : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (submissions ?? []) as any[];

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`Responses · ${rows.length} submission${rows.length === 1 ? "" : "s"}`}
        title={form.name}
        actions={
          <>
            <Link href={`/forms/${form.id}`} className="mono-label inline-flex min-h-11 items-center">
              ← Edit form
            </Link>
            <Link href="/forms" className="mono-label inline-flex min-h-11 items-center">
              All forms →
            </Link>
          </>
        }
      />
      <div className="space-y-3 px-5 py-6 md:px-8 md:py-7">
        <FormResponsesList rows={rows} fields={responseFields(schema)} />
      </div>
    </div>
  );
}
