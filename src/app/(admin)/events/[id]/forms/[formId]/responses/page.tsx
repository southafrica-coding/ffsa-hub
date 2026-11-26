import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { getFormById, listFormSubmissions } from "@/services/forms";
import { formOnEventStatus } from "@/lib/auth/event-access";
import type { FormSchema } from "@/lib/forms/schema";
import { Masthead } from "@/components/ffsa";
import { FormResponsesList, responseFields } from "@/components/forms/form-responses";

// Per-form responses: every submission with the resolved contact + all answers.
export default async function FormResponsesPage({
  params,
}: {
  params: Promise<{ id: string; formId: string }>;
}) {
  const { id: eventId, formId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: form, error } = await getFormById(supabase, formId);
  if (error || formOnEventStatus(form, eventId) !== 200) notFound();

  const { data: submissions } = await listFormSubmissions(supabase, formId);

  const schema: FormSchema | null =
    form.schema && typeof form.schema === "object" && "steps" in form.schema
      ? (form.schema as unknown as FormSchema)
      : null;
  const fields = responseFields(schema);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (submissions ?? []) as any[];

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`Form responses · ${rows.length} submission${rows.length === 1 ? "" : "s"}`}
        title={form.name}
        actions={
          <>
            <Link href={`/events/${eventId}/forms/${formId}`} className="mono-label">
              ← Edit form
            </Link>
            <Link href={`/events/${eventId}?tab=forms`} className="mono-label">
              Event →
            </Link>
          </>
        }
      />

      <div className="space-y-3 px-5 py-6 md:px-8 md:py-7">
        <FormResponsesList rows={rows} fields={fields} />
      </div>
    </div>
  );
}
