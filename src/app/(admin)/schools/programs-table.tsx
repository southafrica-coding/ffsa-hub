import Link from "next/link";
import { SectionBar, StatusPill, Numeral, Bar } from "@/components/ffsa";
import { ProgramActions } from "./program-actions";

type ProgramRow = {
  id: string;
  name: string;
  code: string;
  credit_hours: number;
  status: string;
  created_at: string;
  billing_courses?: { id: string }[];
};

/**
 * Per-school figures the list renders as Numerals and a term Bar. Derived on
 * the page from the school's roster, leader team and dated courses — `term` is
 * null for a school whose courses carry no dates, and that row draws no bar
 * rather than an invented 0%.
 */
export type ProgramStats = {
  students: number;
  staff: number;
  term: { pct: number; phase: string | null; week: number | null } | null;
};

export function ProgramsTable({
  programs,
  statusFilter,
  stats,
}: {
  programs: ProgramRow[];
  statusFilter: string;
  stats?: Record<string, ProgramStats>;
}) {
  return (
    <div className="border border-ink">
      <SectionBar
        title="Schools"
        meta={`${programs.length} ${statusFilter === "archived" ? "archived" : "active"}`}
      />

      {programs.length === 0 ? (
        <p className="mono-label px-6 py-12 text-center">
          {statusFilter === "archived"
            ? "No archived schools"
            : "No schools yet — create your first one to get started"}
        </p>
      ) : (
        programs.map((program) => {
          const stat = stats?.[program.id];
          const term = stat?.term ?? null;
          return (
            <div
              key={program.id}
              className="flex flex-wrap items-end gap-x-8 gap-y-5 border-b border-rule px-6 py-5 last:border-b-0 hover:bg-bone"
            >
              <div className="min-w-[220px] flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-3">
                  <span className="mono-label">
                    {program.code} · {program.credit_hours} credit hrs ·{" "}
                    {program.billing_courses?.length ?? 0} courses
                  </span>
                  <StatusPill tone={program.status === "active" ? "good" : "quiet"}>
                    {program.status}
                  </StatusPill>
                </div>
                <Link
                  href={`/schools/${program.id}`}
                  className="font-display text-[28px] font-black uppercase leading-none tracking-[-0.01em] hover:text-electric"
                >
                  {program.name}
                </Link>
                <p className="mt-2 text-[11px] text-[color:var(--text-tertiary)]">
                  {term?.phase ?? "No phase running"}
                  {term?.week ? ` · Week ${term.week}` : ""}
                  {" · Created "}
                  {new Date(program.created_at).toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>

              <div className="w-16">
                <Numeral size={34}>{stat?.students ?? 0}</Numeral>
                <div className="mono-label mt-2">Students</div>
              </div>

              <div className="w-16">
                <Numeral size={34}>{stat?.staff ?? 0}</Numeral>
                <div className="mono-label mt-2">Staff</div>
              </div>

              <div className="w-[170px]">
                {term ? (
                  <>
                    <div className="mb-2 flex items-baseline justify-between gap-2">
                      <span className="mono-label">Term</span>
                      <span className="numeral text-[19px]">{term.pct}%</span>
                    </div>
                    <Bar pct={term.pct} />
                  </>
                ) : (
                  <span className="mono-label">Term not dated</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Link
                  href={`/schools/${program.id}`}
                  className="border border-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-ink hover:bg-ink hover:text-white"
                >
                  Open
                </Link>
                <ProgramActions program={program} variant="icon" />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
