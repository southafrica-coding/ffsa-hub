import Link from "next/link";
import { StatusPill } from "@/components/ffsa";
import type { FormSchema } from "@/lib/forms/schema";
import { describeField, routeChip } from "./describe";

// ============================================================
// A form template, read only: every question and where it goes
// ============================================================
// The Missio weekly feedback lives in code
// (lib/forms/templates/missio-weekly-feedback.ts) and is put in the
// database by an ops script, not a migration. This shows staff exactly
// what that script will write, before it is run.
// ============================================================

export function TemplatePreview({
  name,
  note,
  schema,
  seeded,
}: {
  name: string;
  note: string;
  schema: FormSchema;
  /** The seeded form's id, if the ops script has run. */
  seeded: { id: string } | null;
}) {
  const count = schema.steps.reduce((n, s) => n + s.fields.length, 0);
  return (
    <div className="ffsa-screen">
      <div className="border-b border-ink bg-white px-5 pb-5 pt-5 md:px-8 md:pt-6">
        <div className="masthead-context">
          <Link href="/forms">Forms</Link> · Template
        </div>
        <h1 className="masthead-title">{name}</h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[color:var(--text-secondary)]">{note}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {seeded ? (
            <Link href={`/forms/${seeded.id}`} className="underline underline-offset-2">
              Open the live form
            </Link>
          ) : (
            <StatusPill tone="warn">Not seeded yet</StatusPill>
          )}
          <span className="text-[13px] text-[color:var(--text-tertiary)]">{count} questions</span>
        </div>
      </div>
      {schema.steps.map((step, i) => (
        <section key={step.id}>
          <div className="section-bar">
            <span className="section-bar-title">
              {i + 1}. {step.title}
            </span>
            <span className="section-bar-meta">{step.fields.length}</span>
          </div>
          <ul className="px-5 py-3 md:px-8">
            {step.fields.map((f) => (
              <li key={f.id} className="border-b border-[color:var(--rule)] py-3 last:border-b-0">
                <p className="text-[15px] font-bold">
                  {f.label}
                  {f.parentFieldId ? <span className="font-normal text-[color:var(--text-tertiary)]"> · only if ticked</span> : null}
                </p>
                <p className="mt-0.5 text-[13px] text-[color:var(--text-secondary)]">{describeField(f)}</p>
                {(f.routes ?? []).length > 0 ? (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {(f.routes ?? []).map((r, j) => (
                      <li key={j} className="border border-[color:var(--rule-strong)] px-2 py-0.5 text-[12px]">
                        {routeChip(r)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
