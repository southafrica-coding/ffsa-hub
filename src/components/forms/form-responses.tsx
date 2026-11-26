import Link from "next/link";
import { fieldKey, numericBounds, type FormField, type FormSchema } from "@/lib/forms/schema";
import { StatusPill } from "@/components/ffsa";

// Every submission for one form, newest first: the resolved contact and
// each answer. Shared by /events/[id]/forms/[formId]/responses and
// /forms/[id]/responses.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SubmissionRow = any;

export function responseFields(schema: FormSchema | null): FormField[] {
  return schema ? schema.steps.flatMap((s) => s.fields).filter((f) => f.type !== "consent") : [];
}

export function FormResponsesList({
  rows,
  fields,
}: {
  rows: SubmissionRow[];
  fields: FormField[];
}) {
  if (rows.length === 0) {
    return (
      <p className="mono-label">
        No submissions yet. Responses appear here as people fill in the form.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {rows.map((sub) => {
        const c = sub.contacts;
        const name = c
          ? `${c.preferred_name ?? c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "—"
          : "(unresolved contact)";
        const raw = (sub.raw_data ?? {}) as Record<string, unknown>;
        return (
          // A plain bordered record, not a Card — the shadcn card slots are
          // zero-padded by the design layer, so the padding lives here.
          <div key={sub.id} className="border border-ink">
            <div className="border-b border-rule px-4 py-3.5 md:px-5 md:py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[16px]">
                    {c?.id ? (
                      <Link href={`/contacts/${c.id}`} className="hover:text-electric">
                        {name}
                      </Link>
                    ) : (
                      name
                    )}
                  </h2>
                  <p className="mt-1 break-all text-[11px] text-[color:var(--text-tertiary)]">
                    {[c?.email, c?.phone].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <StatusPill tone={sub.dedup_action === "queued_for_review" ? "warn" : "quiet"}>
                    {sub.dedup_action === "queued_for_review"
                      ? "Needs review"
                      : sub.dedup_action === "new"
                        ? "New contact"
                        : "Matched"}
                  </StatusPill>
                  <p className="mono-label mt-1.5">{new Date(sub.submitted_at).toLocaleString()}</p>
                </div>
              </div>
            </div>
            <div className="px-4 py-3.5 md:px-5 md:py-4">
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {fields.map((f) => (
                  <div key={f.id} className="min-w-0 text-sm">
                    <dt className="mono-label">{f.label}</dt>
                    <dd className="mt-0.5 break-words">{formatAnswer(f, raw)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function formatAnswer(field: FormField, raw: Record<string, unknown>): string {
  const v = raw[fieldKey(field)];
  if (field.type === "outcome" || field.type === "checkbox") {
    return v === true ? "✓ Yes" : "—";
  }
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (v === null || v === undefined || v === "") return "—";
  if (field.type === "stepper" || field.type === "linear_scale") {
    const n = Number(v);
    const { min, max } = numericBounds(field);
    // A stepper's top can mean "more than": 6 with "More than 5".
    if (field.type === "stepper" && max != null && n === max && field.maxLabel) return field.maxLabel;
    if (field.type === "linear_scale") {
      const end = n === min && field.minLabel ? ` (${field.minLabel})` : n === max && field.maxLabel ? ` (${field.maxLabel})` : "";
      return `${n} of ${max}${end}`;
    }
  }
  return String(v);
}
