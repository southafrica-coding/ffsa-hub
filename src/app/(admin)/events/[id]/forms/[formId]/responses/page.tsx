import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/require-permission";
import { redirect, notFound } from "next/navigation";
import { getFormById, listFormSubmissions } from "@/services/forms";
import { fieldKey, type FormSchema, type FormField } from "@/lib/forms/schema";
import { Masthead, StatusPill } from "@/components/ffsa";

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
  await requireModuleAccess(supabase, user.id, "events");

  const { data: form, error } = await getFormById(supabase, formId);
  if (error || !form) notFound();

  const { data: submissions } = await listFormSubmissions(supabase, formId);

  const schema: FormSchema | null =
    form.schema && typeof form.schema === "object" && "steps" in form.schema
      ? (form.schema as unknown as FormSchema)
      : null;
  const fields: FormField[] = schema
    ? schema.steps.flatMap((s) => s.fields).filter((f) => f.type !== "consent")
    : [];

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
      {rows.length === 0 ? (
        <p className="mono-label">
          No submissions yet. Responses appear here as people fill in the form.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((sub) => {
            const c = sub.contacts;
            const name = c
              ? `${c.preferred_name ?? c.first_name ?? ""} ${c.last_name ?? ""}`.trim() ||
                "—"
              : "(unresolved contact)";
            const raw = (sub.raw_data ?? {}) as Record<string, unknown>;
            return (
              // A plain bordered record, not a Card — the shadcn card slots are
              // zero-padded by the design layer, so the padding lives here.
              <div key={sub.id} className="border border-ink">
                <div className="border-b border-rule px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-[16px]">
                        {c?.id ? (
                          <Link
                            href={`/contacts/${c.id}`}
                            className="hover:text-electric"
                          >
                            {name}
                          </Link>
                        ) : (
                          name
                        )}
                      </h2>
                      <p className="mt-1 text-[11px] text-[color:var(--text-tertiary)]">
                        {[c?.email, c?.phone].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <StatusPill
                        tone={
                          sub.dedup_action === "queued_for_review" ? "warn" : "quiet"
                        }
                      >
                        {sub.dedup_action === "queued_for_review"
                          ? "Needs review"
                          : sub.dedup_action === "new"
                            ? "New contact"
                            : "Matched"}
                      </StatusPill>
                      <p className="mono-label mt-1.5">
                        {new Date(sub.submitted_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="px-5 py-4">
                  <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                    {fields.map((f) => (
                      <div key={f.id} className="text-sm">
                        <dt className="mono-label">{f.label}</dt>
                        <dd className="mt-0.5">{formatAnswer(f, raw)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}

function formatAnswer(field: FormField, raw: Record<string, unknown>): string {
  const v = raw[fieldKey(field)];
  if (field.type === "outcome" || field.type === "checkbox") {
    return v === true ? "✓ Yes" : "—";
  }
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}
