import Link from "next/link";
import { StatusPill } from "@/components/ffsa";
import type { FormAccessMode, FormKind } from "@/lib/forms/schema";
import { ACCESS_MODE_LABELS, KIND_LABELS, accessModeOf, kindOf } from "./describe";
import { NewFormButton } from "./new-form-button";

// ============================================================
// /forms — the list of forms (phone first)
// ============================================================

export type FormListRow = {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
  eventId: string | null;
  eventTitle: string | null;
  kind: FormKind;
  accessMode: FormAccessMode;
  updatedAt: string | null;
  responses: number;
};

/** Shape a listAllForms row for the list. Missing 390 columns read as defaults. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toFormListRow(raw: any): FormListRow {
  const event = Array.isArray(raw.events) ? raw.events[0] : raw.events;
  const counts = Array.isArray(raw.form_submissions) ? raw.form_submissions : [];
  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    isActive: Boolean(raw.is_active),
    eventId: raw.event_id ?? null,
    eventTitle: event?.title ?? null,
    kind: kindOf(raw.kind, raw.event_id),
    accessMode: accessModeOf(raw.access_mode),
    updatedAt: raw.updated_at ?? null,
    responses: Number(counts[0]?.count ?? 0),
  };
}

const DATE = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Johannesburg",
});

function formatUpdated(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : DATE.format(d);
}

export function builderHref(row: Pick<FormListRow, "id" | "eventId">): string {
  return row.eventId ? `/events/${row.eventId}/forms/${row.id}` : `/forms/${row.id}`;
}

export function responsesHref(row: Pick<FormListRow, "id" | "eventId">): string {
  return `${builderHref(row)}/responses`;
}

const LINK_BTN =
  "inline-flex min-h-11 items-center justify-center border px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em]";

function FormRow({ row }: { row: FormListRow }) {
  const updated = formatUpdated(row.updatedAt);
  const meta = [
    row.eventId ? `Event · ${row.eventTitle ?? "untitled"}` : KIND_LABELS[row.kind],
    row.eventId ? ACCESS_MODE_LABELS.public : ACCESS_MODE_LABELS[row.accessMode],
    updated ? `Updated ${updated}` : null,
  ].filter(Boolean);
  return (
    <li className="border-b border-[color:var(--rule)] px-3.5 py-3 last:border-b-0" data-testid="form-row">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link href={builderHref(row)} className="block text-[15px] font-bold leading-snug hover:underline">
            {row.name}
          </Link>
          <p className="mt-0.5 text-[13px] leading-snug text-[color:var(--text-secondary)]">
            {meta.join(" · ")}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <StatusPill tone={row.isActive ? "good" : "quiet"}>{row.isActive ? "Live" : "Draft"}</StatusPill>
          <p className="mt-1.5 font-display text-[22px] font-black leading-none tabular-nums">
            {row.responses}
          </p>
          <p className="mono-label">{row.responses === 1 ? "response" : "responses"}</p>
        </div>
      </div>
      <div className="mt-2.5 flex gap-2">
        <Link href={responsesHref(row)} className={`${LINK_BTN} border-ink bg-ink text-white hover:bg-[var(--ink-bg-hover)] hover:text-white`}>
          Responses
        </Link>
        <Link href={builderHref(row)} className={`${LINK_BTN} border-ink text-ink hover:bg-bone`}>
          Edit
        </Link>
      </div>
    </li>
  );
}

const LATER = [
  { name: "Department request", note: "A Hub form in, Slack updates out, like vehicle requests." },
  { name: "Receipts", note: "A photo and a few taps, then on to finance." },
];

export function FormsLibrary({
  rows,
  loadError,
}: {
  rows: FormListRow[];
  loadError?: string | null;
}) {
  const hub = rows.filter((r) => !r.eventId);
  const events = rows.filter((r) => r.eventId);
  return (
    <div className="ffsa-screen">
      <div className="border-b border-ink bg-white px-5 pb-5 pt-5 md:px-8 md:pt-6">
        <div className="masthead-context">FFSA Hub</div>
        <h1 className="masthead-title">Forms</h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[color:var(--text-secondary)]">
          Build a form, set where each answer goes, share the link and read the responses.
        </p>
        <div className="mt-4">
          <NewFormButton />
        </div>
      </div>

      {loadError && (
        <p role="alert" className="px-5 py-3 text-sm text-destructive md:px-8">
          Couldn&rsquo;t load forms: {loadError}
        </p>
      )}

      <div className="section-bar">
        <span className="section-bar-title">Hub forms</span>
        <span className="section-bar-meta">{hub.length}</span>
      </div>
      <div className="px-5 py-3 md:px-8">
        {hub.length === 0 ? (
          <p className="text-[13px] text-[color:var(--text-tertiary)]">
            No Hub forms yet. New form starts one.
          </p>
        ) : (
          <ul className="border border-[color:var(--rule-strong)]">
            {hub.map((r) => (
              <FormRow key={r.id} row={r} />
            ))}
          </ul>
        )}
      </div>

      <div className="section-bar">
        <span className="section-bar-title">Event forms</span>
        <span className="section-bar-meta">{events.length}</span>
      </div>
      <div className="px-5 py-3 md:px-8">
        {events.length === 0 ? (
          <p className="text-[13px] text-[color:var(--text-tertiary)]">
            Event forms are made on an event&rsquo;s Forms tab and show up here.
          </p>
        ) : (
          <ul className="border border-[color:var(--rule-strong)]">
            {events.map((r) => (
              <FormRow key={r.id} row={r} />
            ))}
          </ul>
        )}
      </div>

      <div className="section-bar">
        <span className="section-bar-title">Coming later</span>
      </div>
      <div className="px-5 py-3 pb-6 md:px-8">
        <ul className="border border-[color:var(--rule-strong)]">
          {LATER.map((l) => (
            <li
              key={l.name}
              className="flex items-start gap-3 border-b border-[color:var(--rule)] px-3.5 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold">{l.name}</p>
                <p className="mt-0.5 text-[13px] text-[color:var(--text-secondary)]">{l.note}</p>
              </div>
              <StatusPill tone="warn">Later</StatusPill>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
