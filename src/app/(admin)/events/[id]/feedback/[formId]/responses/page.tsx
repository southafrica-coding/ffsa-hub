import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Masthead, KpiStrip, Kpi, Bar, SectionBar, StatusPill } from "@/components/ffsa";
import {
  getFeedbackFormById,
  listFeedbackResponses,
} from "@/services/event-feedback";
import { parseFeedbackSchema, allFields, formatAnswer } from "@/lib/feedback/schema";
import {
  summariseFeedback,
  overallScore,
  type FieldSummary,
  type ResponseRow,
} from "@/lib/feedback/summary";

// Results for one feedback form: the pattern first (averages and
// distributions), the individual replies second. A debrief is only useful
// if the summary is the thing you land on.
export default async function FeedbackResponsesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; formId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id: eventId, formId } = await params;
  const { view } = await searchParams;
  const individual = view === "individual";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: form } = await getFeedbackFormById(supabase, formId);
  if (!form || form.event_id !== eventId) notFound();

  const { data: responses } = await listFeedbackResponses(supabase, formId);
  const rows = (responses ?? []) as ResponseRow[];
  const schema = parseFeedbackSchema(form.schema);
  const summaries = summariseFeedback(schema, rows);
  const score = overallScore(summaries);
  const nps = summaries.find((s) => s.kind === "numeric" && s.nps !== null);
  const event = (form.events ?? null) as { title?: string } | null;

  const lastAt = rows.length
    ? new Date(
        Math.max(...rows.map((r) => new Date(r.submitted_at).getTime()))
      ).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
    : "—";

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`${event?.title ?? "Event"} · feedback results`}
        title={form.title}
        actions={
          <>
            <StatusPill tone={form.is_anonymous ? "quiet" : "good"}>
              {form.is_anonymous ? "Anonymous" : "Named"}
            </StatusPill>
            <Link href={`/events/${eventId}/feedback/${formId}`} className="mono-label">
              ← Edit form
            </Link>
            <a
              href={`/api/events/${eventId}/feedback/${formId}/export`}
              className="mono-label"
            >
              Export CSV
            </a>
          </>
        }
      />

      <div className="border-x border-t border-ink">
        <KpiStrip>
          <Kpi label="Responses" value={String(rows.length)} lead />
          <Kpi
            label="Overall score"
            value={score === null ? "—" : `${score}%`}
            foot={score === null ? "NO SCORED QUESTIONS" : "MEAN OF EVERY RATING"}
            bar={score === null ? undefined : { pct: score }}
          />
          <Kpi
            label="Questions"
            value={String(allFields(schema).length)}
            foot={`${schema.sections.length} SECTION${schema.sections.length === 1 ? "" : "S"}`}
          />
          <Kpi
            label="Last response"
            value={lastAt}
            size={rows.length ? 34 : 54}
          />
        </KpiStrip>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-rule bg-bone px-8 py-3">
        <Link href={`/events/${eventId}/feedback/${formId}/responses`}>
          <span
            className={`px-3 py-1.5 text-xs uppercase tracking-[0.12em] border ${
              individual ? "border-rule" : "bg-ink text-white border-ink"
            }`}
          >
            Summary
          </span>
        </Link>
        <Link href={`/events/${eventId}/feedback/${formId}/responses?view=individual`}>
          <span
            className={`px-3 py-1.5 text-xs uppercase tracking-[0.12em] border ${
              individual ? "bg-ink text-white border-ink" : "border-rule"
            }`}
          >
            Individual ({rows.length})
          </span>
        </Link>
      </div>

      <div className="space-y-6 px-8 py-7">
        {rows.length === 0 ? (
          <p className="mono-label">
            No responses yet. They appear here the moment someone submits the
            form.
          </p>
        ) : individual ? (
          <IndividualList form={form} rows={rows} schema={schema} />
        ) : (
          <>
            {nps && nps.kind === "numeric" && nps.nps !== null && (
              <p className="mono-label">
                NPS {nps.nps > 0 ? `+${nps.nps}` : nps.nps} · from {nps.count}{" "}
                answer{nps.count === 1 ? "" : "s"}
              </p>
            )}
            {summaries.map((s) => (
              <SummaryCard key={s.field.id} summary={s} total={rows.length} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────

function SummaryCard({ summary, total }: { summary: FieldSummary; total: number }) {
  const skipped = total - summary.count;

  return (
    <div className="border border-ink">
      <SectionBar
        title={summary.field.label || "Untitled question"}
        meta={
          <span className="mono-label">
            {summary.count} answered{skipped > 0 ? ` · ${skipped} skipped` : ""}
          </span>
        }
      />

      <div className="px-5 py-4">
        {summary.kind === "numeric" && (
          <>
            <div className="flex items-baseline gap-3 mb-4">
              <span className="numeral leading-none" style={{ fontSize: 40 }}>
                {summary.average === null ? "—" : summary.average.toFixed(1)}
              </span>
              <span className="mono-label">
                AVERAGE, OUT OF {summary.max}
                {summary.nps !== null
                  ? ` · NPS ${summary.nps > 0 ? `+${summary.nps}` : summary.nps}`
                  : ""}
              </span>
            </div>
            <ul className="space-y-1.5">
              {summary.distribution.map((d) => {
                const pct = summary.count ? (d.count / summary.count) * 100 : 0;
                return (
                  <li key={d.value} className="flex items-center gap-3">
                    <span className="mono-label w-6 shrink-0">{d.value}</span>
                    <span className="flex-1">
                      <Bar pct={pct} />
                    </span>
                    <span className="mono-label w-16 shrink-0 text-right">
                      {d.count} · {Math.round(pct)}%
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {summary.kind === "choice" && (
          <ul className="space-y-1.5">
            {summary.counts.map((c) => {
              const pct = summary.count ? (c.count / summary.count) * 100 : 0;
              return (
                <li key={c.option} className="flex items-center gap-3">
                  <span className="text-sm w-40 shrink-0 truncate">{c.option}</span>
                  <span className="flex-1">
                    <Bar pct={pct} />
                  </span>
                  <span className="mono-label w-16 shrink-0 text-right">
                    {c.count} · {Math.round(pct)}%
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {summary.kind === "text" &&
          (summary.answers.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No answers yet.</p>
          ) : (
            <ul className="space-y-3">
              {summary.answers.map((a) => (
                <li key={a.responseId} className="border-l-2 border-rule pl-3">
                  <p className="text-sm whitespace-pre-wrap">{a.text}</p>
                  {a.name && <p className="mono-label mt-1">{a.name}</p>}
                </li>
              ))}
            </ul>
          ))}
      </div>
    </div>
  );
}

function IndividualList({
  form,
  rows,
  schema,
}: {
  form: { is_anonymous: boolean };
  rows: ResponseRow[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any;
}) {
  const fields = allFields(schema);
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.id} className="border border-ink">
          <div className="border-b border-rule px-5 py-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[16px]">
                {form.is_anonymous ? "Anonymous" : r.respondent_name || "—"}
              </h2>
              {!form.is_anonymous && r.respondent_email && (
                <p className="mt-1 text-[11px] text-[color:var(--text-tertiary)]">
                  {r.respondent_email}
                </p>
              )}
            </div>
            <p className="mono-label shrink-0">
              {new Date(r.submitted_at).toLocaleString()}
            </p>
          </div>
          <div className="px-5 py-4">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.id} className="text-sm">
                  <dt className="mono-label">{f.label || "Untitled question"}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap">
                    {formatAnswer(f, r.answers ?? {})}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      ))}
    </div>
  );
}
