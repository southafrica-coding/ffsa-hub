"use client";

/**
 * School detail · Overview.
 *
 * The school-wide picture, top to bottom: what needs doing, where the course
 * run is, who is in which course, and fees by track. The Students tab is the
 * list; this tab is the summary, so neither has to do both.
 *
 * Every number comes from data the page already loads — nothing is invented to
 * fill a cell. The one yellow band sits at the top and only when something
 * really waits on someone; each item opens the Students list filtered to it.
 */

import { Bar, NeedsYou, SectionBar } from "@/components/ffsa";
import { courseTiming, type SchoolCourse } from "@/lib/schools/course-arrival";
import { cn } from "@/lib/utils/cn";
import {
  trackLabel,
  type RosterFilter,
  type RosterRow,
  type TrackSegmentOption,
} from "./roster-tab";

export type OverviewRow = RosterRow & {
  /** Ids of the courses on this student's track. */
  courseIds: string[];
  /** Per-course arrival marks (migration 259), legacy arrivals filled in. */
  arrivals: Record<string, "arrived" | "no_show">;
};

const DAY = 86_400_000;
const shortMonth = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-ZA", { month: "short" });

function courseWhen(c: SchoolCourse, today: string): { state: "done" | "now" | "next"; note: string } {
  const timing = courseTiming(c, today);
  if (timing === "ended") return { state: "done", note: "Done" };
  if (timing === "upcoming") return { state: "next", note: c.start_date ? "Next" : "No dates set" };
  if (!c.start_date || !c.end_date) return { state: "now", note: "Now" };
  const start = new Date(`${c.start_date}T00:00:00`).getTime();
  const end = new Date(`${c.end_date}T00:00:00`).getTime();
  const now = new Date(`${today}T00:00:00`).getTime();
  const total = Math.max(1, Math.round((end - start) / (DAY * 7)));
  const week = Math.min(total, Math.floor((now - start) / (DAY * 7)) + 1);
  return { state: "now", note: `Now · week ${week} of ${total}` };
}

const th = "px-3 py-2.5 text-right font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-[color:var(--text-secondary)]";
const td = "px-3 py-3 text-right text-[14px] tabular-nums";

export function OverviewTab({
  rows,
  courses,
  trackSegments,
  staffOnSchool,
  feesBilledOutside,
  today,
  onOpenStudents,
}: {
  /** Active students only. */
  rows: OverviewRow[];
  /** Every course on the school, in order. */
  courses: SchoolCourse[];
  /** Non-empty when the school is split into courses (FFX). */
  trackSegments: TrackSegmentOption[];
  staffOnSchool: number;
  feesBilledOutside: boolean;
  today: string;
  onOpenStudents: (filter: RosterFilter) => void;
}) {
  const split = trackSegments.length > 0;
  const count = (pred: (r: OverviewRow) => boolean) => rows.filter(pred).length;

  // ── Needs you ──
  const byStatus = (key: string) => rows.filter((r) => r.status.key === key);
  const expected = byStatus("expected");
  const noShows = byStatus("no_show");
  const courseOf = (list: OverviewRow[]) => {
    const codes = [...new Set(list.map((r) => r.status.courseCode).filter(Boolean))];
    return codes.length === 1 ? ` for ${codes[0]}` : "";
  };
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const needs: Array<{ text: string; filter: RosterFilter }> = [];
  if (expected.length)
    needs.push({ text: `${plural(expected.length, "student", "students")} not marked arrived${courseOf(expected)}`, filter: "status:expected" });
  if (noShows.length)
    needs.push({ text: `${plural(noShows.length, "no-show", "no-shows")}${courseOf(noShows)}`, filter: "status:no_show" });
  const unassigned = count((r) => !r.staffId);
  if (unassigned)
    needs.push({ text: `${plural(unassigned, "student", "students")} with no one walking with them`, filter: "unassigned" });
  const noTrack = split ? count((r) => r.track.kind === "unknown") : 0;
  if (noTrack) needs.push({ text: `${plural(noTrack, "student", "students")} with no track set`, filter: "no_track" });
  const owing = count((r) => r.fee.owed);
  if (owing) needs.push({ text: `${plural(owing, "student", "students")} with fees overdue`, filter: "owing" });
  const noPlan = feesBilledOutside ? 0 : count((r) => !r.fee.progress);
  if (noPlan) needs.push({ text: `${plural(noPlan, "student", "students")} with no fee plan`, filter: "no_plan" });

  // ── Tracks ──
  const trackGroups = new Map<string, OverviewRow[]>();
  for (const r of rows) {
    const label = split ? trackLabel(r.track, trackSegments) : "All students";
    if (!trackGroups.has(label)) trackGroups.set(label, []);
    trackGroups.get(label)!.push(r);
  }
  // All courses first, then single courses in running order, then combinations, then "not set".
  const order = (label: string) =>
    label === "All courses" ? 0 : label === "Track not set" ? 99 : label.includes("+") ? 50 : 1 + trackSegments.findIndex((s) => s.code === label);
  const groups = [...trackGroups.entries()].sort((a, b) => order(a[0]) - order(b[0]));

  return (
    <div className="flex flex-col">
      {needs.length > 0 && (
        <NeedsYou>
          <span className="flex flex-wrap gap-x-5 gap-y-1">
            {needs.map((n) => (
              <button
                key={n.filter}
                type="button"
                onClick={() => onOpenStudents(n.filter)}
                className="!font-sans text-left text-[14px] !font-semibold normal-case tracking-normal text-ink underline-offset-4 hover:underline"
              >
                {n.text} →
              </button>
            ))}
          </span>
        </NeedsYou>
      )}

      {/* ── Course run ── */}
      {courses.length > 0 && (
        <div
          className="grid gap-3 border-b border-rule px-5 py-5 md:px-8"
          style={{ gridTemplateColumns: `repeat(${Math.min(courses.length, 4)}, minmax(0, 1fr))` }}
        >
          {courses.map((c) => {
            const when = courseWhen(c, today);
            return (
              <div
                key={c.id}
                className={cn(
                  "min-w-0 px-4 py-3",
                  when.state === "now" ? "border-2 border-ink" : "border border-rule-strong",
                  when.state === "done" && "bg-bone"
                )}
              >
                <div
                  className={cn(
                    "font-mono text-[11px] font-bold uppercase tracking-[0.1em]",
                    when.state === "now" ? "text-ink" : "text-[color:var(--text-secondary)]"
                  )}
                >
                  {when.note}
                </div>
                <div className="mt-1 font-display text-[24px] font-black uppercase leading-none text-ink">{c.code}</div>
                <div className="mt-1.5 truncate text-[13px] text-[color:var(--text-secondary)]" title={c.name}>
                  {c.start_date && c.end_date ? `${shortMonth(c.start_date)} – ${shortMonth(c.end_date)} · ` : ""}
                  {c.name}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Students ── */}
      <SectionBar
        title={split ? "Students per course" : "Students"}
        meta={`${rows.length} STUDENTS · ${staffOnSchool} STAFF`}
      />
      <div className="overflow-x-auto px-5 pb-2 md:px-8">
        {split ? (
          <table className="w-full min-w-[480px] border-collapse">
            <thead>
              <tr className="border-b border-ink">
                <th className={cn(th, "text-left")}>Course</th>
                <th className={th}>Signed up</th>
                <th className={th}>Arrived</th>
                <th className={th}>Not arrived</th>
                <th className={th}>No-show</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => {
                const on = rows.filter((r) => r.courseIds.includes(c.id));
                const arrived = on.filter((r) => r.arrivals[c.id] === "arrived").length;
                const noShow = on.filter((r) => r.arrivals[c.id] === "no_show").length;
                const started = courseTiming(c, today) !== "upcoming";
                return (
                  <tr key={c.id} className="border-b border-rule last:border-b-0">
                    <td className={cn(td, "text-left font-bold")}>{c.code}</td>
                    <td className={td}>{on.length}</td>
                    <td className={td}>{arrived}</td>
                    <td className={cn(td, started && on.length - arrived - noShow > 0 && "font-bold text-[color:var(--amber)]")}>
                      {started ? on.length - arrived - noShow : "—"}
                    </td>
                    <td className={cn(td, noShow > 0 && "font-bold text-destructive")}>{started ? noShow : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="w-full min-w-[360px] border-collapse">
            <thead>
              <tr className="border-b border-ink">
                <th className={cn(th, "text-left")}>Students</th>
                <th className={th}>Arrived</th>
                <th className={th}>Waiting</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={cn(td, "text-left font-bold")}>{rows.length}</td>
                <td className={td}>{count((r) => r.status.key === "arrived")}</td>
                <td className={td}>{count((r) => r.status.key === "waiting")}</td>
              </tr>
            </tbody>
          </table>
        )}
        {split && (
          <p className="py-3 text-[13px] text-[color:var(--text-secondary)]">
            Tracks: {groups.map(([label, list]) => `${list.length} ${label}`).join(" · ")}
          </p>
        )}
      </div>

      {/* ── Fees ── */}
      <SectionBar title={split ? "Fees by track" : "Fees"} />
      <div className="overflow-x-auto px-5 pb-6 md:px-8">
        {feesBilledOutside ? (
          <p className="py-4 text-[14px] text-[color:var(--text-secondary)]">
            This school is billed outside the Hub, so there are no fee numbers to show here.
          </p>
        ) : (
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b border-ink">
                <th className={cn(th, "text-left")}>{split ? "Track" : "Students"}</th>
                <th className={th}>Students</th>
                <th className={cn(th, "w-[220px] text-left")}>Collected</th>
                <th className={th}>Paid in full</th>
                <th className={th}>Part paid</th>
                <th className={th}>Not paid</th>
                <th className={th}>No plan</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([label, list]) => {
                const paid = list.reduce((s, r) => s + (r.fee.amounts?.paid ?? 0), 0);
                const total = list.reduce((s, r) => s + (r.fee.amounts?.total ?? 0), 0);
                const pct = total > 0 ? Math.round((paid / total) * 100) : null;
                const pctOf = (r: OverviewRow) => r.fee.progress?.percentPaid;
                const full = list.filter((r) => pctOf(r) === 100).length;
                const part = list.filter((r) => (pctOf(r) ?? 0) > 0 && (pctOf(r) ?? 0) < 100).length;
                const none = list.filter((r) => pctOf(r) === 0).length;
                const noPlanHere = list.filter((r) => !r.fee.progress).length;
                return (
                  <tr key={label} className="border-b border-rule last:border-b-0">
                    <td className={cn(td, "text-left font-bold")}>{label}</td>
                    <td className={td}>{list.length}</td>
                    <td className={cn(td, "text-left")}>
                      {pct === null ? (
                        <span className="text-[color:var(--text-secondary)]">—</span>
                      ) : (
                        <span className="flex items-center gap-3">
                          <span className="min-w-0 flex-1">
                            <Bar pct={pct} />
                          </span>
                          <span className="w-10 shrink-0 text-right">{pct}%</span>
                        </span>
                      )}
                    </td>
                    <td className={td}>{full}</td>
                    <td className={td}>{part}</td>
                    <td className={cn(td, none > 0 && "font-bold text-[color:var(--amber)]")}>{none}</td>
                    <td className={td}>{noPlanHere}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
