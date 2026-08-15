import Link from "next/link";
import { SectionBar, StatusPill, Initials } from "@/components/ffsa";

export type PipelineRow = {
  id: string;
  programId: string;
  programName: string;
  name: string;
  status: string;
  note: string | null;
  submittedAt: string | null;
};

export type NextIntake = {
  courseName: string;
  programName: string;
  startDate: string;
  daysAway: number;
} | null;

// Only the undecided statuses reach this column, but the map covers the whole
// lifecycle so a status added later degrades to "quiet" instead of throwing.
const TONE: Record<string, "good" | "warn" | "quiet" | "bad"> = {
  submitted: "quiet",
  waiting_for_references: "warn",
  references_received: "quiet",
  interview_scheduled: "good",
  accepted: "good",
  rejected: "bad",
  waitlisted: "warn",
  cancelled: "quiet",
};

export function ApplicantPipeline({
  rows,
  total,
  nextIntake,
}: {
  rows: PipelineRow[];
  total: number;
  nextIntake: NextIntake;
}) {
  return (
    <aside className="flex flex-col border border-ink">
      <SectionBar title="Applicant pipeline" meta={`${total} awaiting`} />

      <div className="flex-1">
        {rows.length === 0 ? (
          <p className="mono-label px-5 py-10 text-center">
            Nobody is waiting on a decision
          </p>
        ) : (
          rows.map((row) => (
            <Link
              key={row.id}
              href={`/schools/${row.programId}?tab=applicants`}
              className="flex items-start gap-3 border-b border-rule px-5 py-3.5 hover:bg-bone"
            >
              <Initials name={row.name} size={30} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-[13px] font-medium text-[color:var(--text-primary)]">
                    {row.name}
                  </p>
                  <StatusPill tone={TONE[row.status] ?? "quiet"}>
                    {row.status.replace(/_/g, " ")}
                  </StatusPill>
                </div>
                <p className="mt-1 truncate text-[11px] text-[color:var(--text-tertiary)]">
                  {row.programName}
                  {row.submittedAt ? ` · ${waitedFor(row.submittedAt)}` : ""}
                </p>
                {row.note && (
                  <p className="mt-1.5 truncate text-[11px] text-[color:var(--text-secondary)]">
                    {row.note}
                  </p>
                )}
              </div>
            </Link>
          ))
        )}
      </div>

      {/* Pinned to the bottom of the column — the next thing on the calendar,
          not another pipeline row. */}
      {nextIntake && (
        <div className="mt-auto border-t border-ink bg-bone px-5 py-4">
          <div className="mono-label mb-2">Next intake</div>
          <p className="font-display text-[20px] font-black uppercase leading-none tracking-[-0.01em]">
            {nextIntake.courseName}
          </p>
          <p className="mt-1.5 text-[11px] text-[color:var(--text-tertiary)]">
            {nextIntake.programName}
          </p>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="numeral text-[30px]">{nextIntake.daysAway}</span>
            <span className="mono-label">
              {nextIntake.daysAway === 1 ? "day away" : "days away"} ·{" "}
              {formatDay(nextIntake.startDate)}
            </span>
          </div>
        </div>
      )}
    </aside>
  );
}

/** "waiting 12 days" — how long this application has sat undecided. */
function waitedFor(submittedAt: string) {
  const days = Math.max(
    0,
    Math.round((Date.now() - Date.parse(submittedAt)) / 86_400_000)
  );
  if (days === 0) return "waiting since today";
  return days === 1 ? "waiting 1 day" : `waiting ${days} days`;
}

// Date-only string; appending midnight keeps it off the UTC boundary, where a
// bare `new Date("2026-08-15")` can render the 14th.
function formatDay(iso: string) {
  return new Date(`${iso}T00:00:00`)
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .toUpperCase();
}
