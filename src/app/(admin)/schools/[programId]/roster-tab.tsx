"use client";

/**
 * Frame 14a — school detail · students.
 *
 * Two halves inside the content area: a 300px phase run that answers "where is
 * this cohort" permanently, and the roster as a real six-column table.
 *
 * The rules the frame encodes, so a later edit doesn't quietly undo them:
 *   · only the CURRENT phase gets a black border and 900 weight
 *   · fees turn amber and 700 weight when money is owed, never otherwise
 *   · "walking with" is an em dash in #B4B0A2 when nobody is assigned — that
 *     dash is exactly what the NeedsYou band at the bottom counts
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bar, Chip, Initials, NeedsYou, SectionBar } from "@/components/ffsa";
import { ENROLLMENT_STATUS_LABELS } from "@/lib/schools/student-export-columns";
import { cn } from "@/lib/utils/cn";

export type PhaseCourseRow = {
  id: string;
  code: string;
  name: string;
  sequence: number;
  status: string;
  start_date: string | null;
  end_date: string | null;
};

export type RosterFee = {
  /** What to print in the fees column. */
  label: string;
  /** True only when real money is outstanding — drives the amber + 700. */
  owed: boolean;
  /** Hub-billed students: how far through their fees they are (0–100) and
   *  what's overdue, for the slim progress bar. Absent = label only. */
  progress?: { percentPaid: number; overdue: number };
};

export type RosterRow = {
  enrollmentId: string;
  /** NULL when the person's account was deleted — the enrolment survives (migration 207). */
  userId: string | null;
  name: string;
  from: string | null;
  status: string;
  staffId: string | null;
  staffName: string | null;
  fee: RosterFee;
  gradedCount: number;
  removed: boolean;
  /** The student's track (migration 221) — what the Track column shows and sets. */
  track: RosterTrack;
};

export type RosterTrack = { kind: "whole" | "segments" | "unknown"; codes: string[] };
export type TrackSegmentOption = { code: string; name: string };

/** Every choice the Track column offers: whole program, each course alone, then each combination. */
export function trackOptions(segments: TrackSegmentOption[]): Array<{ value: string; label: string }> {
  const codes = segments.map((s) => s.code);
  const out = [{ value: "whole", label: "Whole program" }];
  for (const c of codes) out.push({ value: c, label: `${c} only` });
  // Combinations of two or more courses short of all of them (all = whole program).
  for (let mask = 1; mask < (1 << codes.length) - 1; mask++) {
    const pick = codes.filter((_, i) => mask & (1 << i));
    if (pick.length >= 2) out.push({ value: pick.join("+"), label: pick.join(" + ") });
  }
  return out;
}

export function trackValue(t: RosterTrack, segments: TrackSegmentOption[]): string {
  if (t.kind === "whole") return "whole";
  if (t.kind === "unknown" || t.codes.length === 0) return "";
  if (t.codes.length === segments.length) return "whole";
  const order = segments.map((s) => s.code);
  return [...t.codes].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join("+");
}

export type StaffOption = { id: string; name: string };

/* ── Phase run ────────────────────────────────────────────── */

type PhaseState = "done" | "now" | "next";

type Phase = {
  id: string;
  name: string;
  length: string;
  state: PhaseState;
  pct: number;
  note: string;
};

const DAY = 86_400_000;

function weeksBetween(from: Date, to: Date): number {
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / (DAY * 7)));
}

/**
 * Derive each phase's state from its dates, falling back to the stored
 * lifecycle status when a course has none. Only the FIRST phase that reads as
 * running is marked `now` — two bordered rows would break the frame's one
 * answer to "where are we".
 */
export function buildPhaseRun(courses: PhaseCourseRow[], today = new Date()): Phase[] {
  let currentTaken = false;

  return [...courses]
    .sort((a, b) => a.sequence - b.sequence)
    .map((c) => {
      const start = c.start_date ? new Date(c.start_date) : null;
      const end = c.end_date ? new Date(c.end_date) : null;

      let state: PhaseState;
      let pct = 0;
      let note: string;

      if (start && end) {
        const total = weeksBetween(start, end);
        if (today >= end) {
          state = "done";
          pct = 100;
          note = "COMPLETE";
        } else if (today >= start) {
          state = "now";
          const elapsed = weeksBetween(start, today);
          pct = Math.min(100, Math.round(((today.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100));
          note = `IN PROGRESS · WEEK ${Math.min(elapsed, total)} OF ${total}`;
        } else {
          state = "next";
          note = "NOT STARTED";
        }
      } else {
        // No dates configured — the status column is all we have to go on.
        state = c.status === "completed" ? "done" : c.status === "active" ? "now" : "next";
        pct = state === "done" ? 100 : 0;
        note = state === "done" ? "COMPLETE" : state === "now" ? "IN PROGRESS" : "NO DATES SET";
      }

      if (state === "now") {
        if (currentTaken) state = "next";
        else currentTaken = true;
      }

      const length = start && end ? `${weeksBetween(start, end)} WEEKS` : "—";
      return { id: c.id, name: c.name, length, state, pct, note };
    });
}

function PhaseRunRow({ phase }: { phase: Phase }) {
  const isNow = phase.state === "now";
  return (
    <div
      className={cn(
        "border p-3",
        isNow ? "border-ink bg-white" : phase.state === "done" ? "border-[#E7E4D9] bg-bone-2" : "border-[#E7E4D9] bg-white"
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="h-[9px] w-[9px] shrink-0"
          style={{
            background:
              phase.state === "done" ? "#0A0A0A" : phase.state === "now" ? "#FFB801" : "#DEDACE",
          }}
        />
        <span
          className={cn(
            "min-w-0 flex-1 font-display text-[17px] uppercase leading-[1.05] text-ink",
            isNow ? "font-black" : "font-bold"
          )}
        >
          {phase.name}
        </span>
        <span className="shrink-0 font-mono text-[9px] font-bold tracking-[0.1em] text-[color:var(--text-tertiary)]">
          {phase.length}
        </span>
      </div>
      <div className="my-2.5">
        <Bar pct={phase.pct} />
      </div>
      <div
        className={cn(
          "font-mono text-[8.5px] font-bold tracking-[0.12em]",
          isNow ? "text-ink" : "text-[color:var(--text-tertiary)]"
        )}
      >
        {phase.note}
      </div>
    </div>
  );
}

/* ── Roster status pill ───────────────────────────────────── */

// The frame's pill is FILLED, not the outlined <StatusPill> primitive: on a
// dense roster an outline reads as another hairline. Colours are the frame's.
const PILL_FILL: Record<string, string> = {
  arrived: "#0A0A0A",
  active: "#0A0A0A",
  waiting_for_arrival: "#8A6400",
  on_hold: "#8A6400",
  graduated: "#2F6620",
  completed: "#2F6620",
  dismissed: "#9A9689",
  decided_to_leave: "#9A9689",
  withdrawn: "#9A9689",
};

function RosterStatusPill({ status }: { status: string }) {
  return (
    <span
      className="inline-block px-2 py-1 font-mono text-[8.5px] font-bold uppercase leading-none tracking-[0.12em] text-white"
      style={{ background: PILL_FILL[status] ?? "#9A9689" }}
    >
      {ENROLLMENT_STATUS_LABELS[status] ?? status}
    </span>
  );
}

/* ── The tab ──────────────────────────────────────────────── */

const COLS = "minmax(0,1fr) 112px 148px 132px 132px 64px";
// A school split into courses swaps FROM (moved under the name) for TRACK, so
// the roster stays six columns and names keep their room on a laptop.
const COLS_WITH_TRACK = "minmax(0,1fr) 148px 156px 124px 124px 56px";

export function RosterTab({
  phaseCourses,
  rows,
  staffOptions,
  courseCount,
  staffOnSchool,
  trackSegments = [],
  actions,
}: {
  phaseCourses: PhaseCourseRow[];
  rows: RosterRow[];
  staffOptions: StaffOption[];
  /** Denominator of the GRADED column. */
  courseCount: number;
  staffOnSchool: number;
  /** The school's courses when it's split into tracks (FFX); empty hides the Track column. */
  trackSegments?: TrackSegmentOption[];
  /** Export / enrol controls — owned by the parent, rendered above the table. */
  actions?: React.ReactNode;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [assigning, setAssigning] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [settingTrack, setSettingTrack] = useState<string | null>(null);
  const hasTracks = trackSegments.length > 0;
  const cols = hasTracks ? COLS_WITH_TRACK : COLS;
  const choices = useMemo(() => trackOptions(trackSegments), [trackSegments]);

  const phases = useMemo(() => buildPhaseRun(phaseCourses), [phaseCourses]);

  const active = useMemo(() => rows.filter((r) => !r.removed), [rows]);
  const removed = useMemo(() => rows.filter((r) => r.removed), [rows]);
  const unassignedCount = active.filter((r) => !r.staffId).length;

  // Headcount per track (migration 221), straight from each student's Track
  // column. Whole-program students count once, under Whole program — a
  // course's number is only the students doing that course without the rest.
  const trackCounts = useMemo(() => {
    if (!hasTracks) return [];
    const whole = active.filter((r) => r.track.kind === "whole").length;
    const rows: Array<[string, number]> = [["Whole program", whole]];
    for (const seg of trackSegments) {
      rows.push([seg.code, active.filter((r) => r.track.kind === "segments" && r.track.codes.includes(seg.code)).length]);
    }
    const unset = active.filter((r) => r.track.kind === "unknown").length;
    if (unset > 0) rows.push(["Not set", unset]);
    return rows;
  }, [active, hasTracks, trackSegments]);

  async function setTrack(row: RosterRow, value: string) {
    if (!value) return;
    setSettingTrack(row.enrollmentId);
    try {
      const res = await fetch("/api/schools/enrollments/track", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollmentId: row.enrollmentId,
          wholeProgram: value === "whole",
          codes: value === "whole" ? [] : value.split("+"),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Couldn't save the track");
        return;
      }
      if (data.warning) alert(`${row.name}: ${data.warning}`);
      router.refresh();
    } finally {
      setSettingTrack(null);
    }
  }

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of active) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    return counts;
  }, [active]);

  const visible = useMemo(() => {
    const base =
      filter === "removed"
        ? removed
        : filter === "unassigned"
          ? active.filter((r) => !r.staffId)
          : filter === "all"
            ? active
            : active.filter((r) => r.status === filter);
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.from ?? "").toLowerCase().includes(q)
    );
  }, [filter, query, active, removed]);

  async function assignStaff(enrollmentId: string, staffId: string | null) {
    setAssigning(enrollmentId);
    try {
      const res = await fetch("/api/schools/enrollments/assign-staff", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollment_id: enrollmentId, assigned_staff_id: staffId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to assign staff");
        return;
      }
      router.refresh();
    } finally {
      setAssigning(null);
    }
  }

  /**
   * Reversible by default: "remove" is a soft removal that lands the student
   * under the Removed chip, and only a removed student can be deleted for good.
   */
  async function mutateRow(row: RosterRow, action: "remove" | "restore" | "delete") {
    if (action === "delete") {
      const ok = confirm(
        `Permanently delete ${row.name} from this school?\n\n` +
          "This removes their enrolment, grades and fees for this school and cannot be undone. " +
          "Their Hub account is not affected."
      );
      if (!ok) return;
    }
    setBusyRow(row.enrollmentId);
    setMenuFor(null);
    try {
      const res = await fetch("/api/schools/enrollments", {
        method: action === "delete" ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "delete"
            ? { id: row.enrollmentId }
            : { id: row.enrollmentId, removed: action === "remove" }
        ),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "That didn't work");
        return;
      }
      router.refresh();
    } catch {
      alert("That didn't work — check your connection");
    } finally {
      setBusyRow(null);
    }
  }

  return (
    <div className="grid min-h-0 grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)]">
      {/* ── Phase run ── */}
      <div className="flex flex-col border-b border-ink bg-[#F7F5EE] md:sticky md:top-0 md:max-h-screen md:self-start md:overflow-y-auto md:border-b-0 md:border-r">
        <SectionBar title="Phase run" />
        <div className="flex flex-col gap-2 p-4">
          {phases.length === 0 ? (
            <p className="mono-label py-6 text-center">No courses set up yet</p>
          ) : (
            phases.map((p) => <PhaseRunRow key={p.id} phase={p} />)
          )}
        </div>
        <div className="flex gap-10 border-t border-rule px-5 py-4 md:flex-col md:gap-4">
          <div>
            <div className="numeral text-[38px] leading-none">{active.length}</div>
            <div className="mono-label mt-0.5">Students enrolled</div>
          </div>
          <div>
            <div className="numeral text-[38px] leading-none">{staffOnSchool}</div>
            <div className="mono-label mt-0.5">Staff on school</div>
          </div>
        </div>
        {trackCounts.length > 0 && (
          <div className="border-t border-rule px-5 py-4">
            <div className="mono-label mb-2">By track</div>
            <div className="flex flex-col gap-1.5">
              {trackCounts.map(([track, n]) => (
                  <div key={track} className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[13px] font-semibold text-ink">{track}</span>
                    <span className="numeral shrink-0 text-[17px]">{n}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Roster ── */}
      <div className="flex min-w-0 flex-col">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-rule px-5 py-3 md:px-6">
          <button type="button" onClick={() => setFilter("all")}>
            <Chip active={filter === "all"}>All {active.length}</Chip>
          </button>
          {[...statusCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([status, n]) => (
              <button key={status} type="button" onClick={() => setFilter(status)}>
                <Chip active={filter === status}>
                  {ENROLLMENT_STATUS_LABELS[status] ?? status} {n}
                </Chip>
              </button>
            ))}
          {unassignedCount > 0 && (
            <button type="button" onClick={() => setFilter("unassigned")}>
              <Chip active={filter === "unassigned"}>Unassigned {unassignedCount}</Chip>
            </button>
          )}
          {removed.length > 0 && (
            <button type="button" onClick={() => setFilter("removed")}>
              <Chip active={filter === "removed"}>Removed {removed.length}</Chip>
            </button>
          )}
          <span className="flex-1" />
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="FIND STUDENT"
              aria-label="Find student"
              className="w-[150px] border border-ink bg-bone px-2.5 py-1.5 font-mono text-[9.5px] font-bold tracking-[0.12em] text-[color:var(--text-secondary)] placeholder:text-[color:var(--text-tertiary)] focus:outline-none"
            />
            {actions}
          </div>
        </div>

        {/* Column head — desktop only; the phone layout is a card per student. */}
        <div
          className="hidden border-b border-ink bg-bone px-6 py-2.5 md:grid"
          style={{ gridTemplateColumns: cols }}
        >
          {["Student", ...(hasTracks ? [] : ["From"]), "Status", ...(hasTracks ? ["Track"] : []), "Walking with", "Fees"].map((h) => (
            <span key={h} className="mono-label">{h}</span>
          ))}
          <span className="mono-label text-right">Graded</span>
        </div>

        <div className="min-h-0 flex-1">
          {visible.length === 0 ? (
            <p className="mono-label px-6 py-10 text-center">
              {rows.length === 0 ? "No students enrolled yet" : "No students match this filter"}
            </p>
          ) : (
            visible.map((r) => (
              <div
                key={r.enrollmentId}
                className={cn(
                  "block border-b border-rule px-5 py-3 hover:bg-[#F7F5EE] md:grid md:items-center md:px-6",
                  r.removed && "opacity-60"
                )}
                style={{ gridTemplateColumns: cols }}
              >
                <div className="group/row relative flex min-w-0 items-center gap-3">
                  <Initials name={r.name} size={30} />
                  <span className="flex min-w-0 flex-col">
                  {r.userId ? (
                    <Link
                      href={`/users/${r.userId}`}
                      title={r.name}
                      className="truncate text-[14.5px] font-bold text-ink hover:text-electric"
                    >
                      {r.name}
                    </Link>
                  ) : (
                    // No account to link to: this enrolment outlived a deleted
                    // profile (migration 207). Name only, so the student stays
                    // on the roster instead of vanishing.
                    <span
                      title={`${r.name} — account deleted`}
                      className="truncate text-[14.5px] font-bold text-muted-foreground"
                    >
                      {r.name}
                    </span>
                  )}
                  {hasTracks && r.from && (
                    <span className="hidden truncate text-[11.5px] text-[color:var(--text-secondary)] md:block">{r.from}</span>
                  )}
                  </span>
                  {/* Roll-off lives here rather than in a seventh column — the
                      frame's roster is six columns and stays six columns. */}
                  <button
                    type="button"
                    disabled={busyRow === r.enrollmentId}
                    onClick={() => setMenuFor(menuFor === r.enrollmentId ? null : r.enrollmentId)}
                    aria-label={`Actions for ${r.name}`}
                    className="ml-auto mr-3 shrink-0 px-1 font-mono text-[13px] leading-none text-[color:var(--text-tertiary)] opacity-0 hover:text-ink focus:opacity-100 group-hover/row:opacity-100"
                  >
                    ⋯
                  </button>
                  {menuFor === r.enrollmentId && (
                    <div className="absolute right-2 top-full z-20 w-[190px] border border-ink bg-white">
                      {r.removed ? (
                        <>
                          <button
                            type="button"
                            onClick={() => mutateRow(r, "restore")}
                            className="block w-full border-b border-rule px-3 py-2 !font-sans text-left text-[13px] !font-semibold normal-case tracking-normal text-ink hover:bg-[#F7F5EE]"
                          >
                            Restore to school
                          </button>
                          <button
                            type="button"
                            onClick={() => mutateRow(r, "delete")}
                            className="block w-full px-3 py-2 !font-sans text-left text-[13px] !font-semibold normal-case tracking-normal text-destructive hover:bg-[#F7F5EE]"
                          >
                            Delete permanently
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => mutateRow(r, "remove")}
                          className="block w-full px-3 py-2 !font-sans text-left text-[13px] !font-semibold normal-case tracking-normal text-ink hover:bg-[#F7F5EE]"
                        >
                          Remove from school
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Phones get labelled pairs; the grid columns only exist from md. */}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-[42px] md:mt-0 md:contents">
                  <span className={cn("text-[13px] text-[color:var(--text-secondary)]", hasTracks && "md:hidden")}>
                    {r.from ?? "—"}
                  </span>
                  <span>
                    <RosterStatusPill status={r.status} />
                  </span>
                  {/* The track column only exists for a school split into
                      courses (FFX) — every other roster keeps the frame's six. */}
                  {hasTracks && (
                    <span>
                      <select
                        value={trackValue(r.track, trackSegments)}
                        disabled={settingTrack === r.enrollmentId || r.removed}
                        aria-label={`Track for ${r.name}`}
                        onChange={(e) => setTrack(r, e.target.value)}
                        className={cn(
                          "w-full max-w-full cursor-pointer truncate border-0 bg-transparent p-0 pr-2 text-[13px] font-semibold focus:outline-none",
                          r.track.kind === "unknown" ? "text-[color:var(--amber)]" : "text-ink"
                        )}
                      >
                        {r.track.kind === "unknown" && <option value="">Not set</option>}
                        {choices.map((c) => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                    </span>
                  )}
                  <span>
                    <select
                      value={r.staffId ?? ""}
                      disabled={assigning === r.enrollmentId}
                      aria-label={`Staff walking with ${r.name}`}
                      onChange={(e) => assignStaff(r.enrollmentId, e.target.value || null)}
                      className={cn(
                        "w-full max-w-full cursor-pointer truncate border-0 bg-transparent p-0 pr-2 text-[13px] font-semibold focus:outline-none",
                        r.staffId ? "text-ink" : "text-[#B4B0A2]"
                      )}
                    >
                      {/* The em dash IS the empty state the band counts. */}
                      <option value="">—</option>
                      {staffOptions.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </span>
                  <span className="min-w-0 pr-3">
                    {r.fee.progress && (
                      <span
                        className="mb-1 block h-1.5 w-full max-w-[120px] overflow-hidden border border-ink bg-white"
                        aria-hidden
                      >
                        <span
                          className="block h-full bg-grass"
                          style={{ width: `${Math.min(100, r.fee.progress.percentPaid)}%` }}
                        />
                      </span>
                    )}
                    <span
                      className={cn(
                        "block font-mono text-[10px] tracking-[0.06em]",
                        r.fee.owed
                          ? "font-bold text-[color:var(--amber)]"
                          : "font-medium text-[color:var(--text-secondary)]"
                      )}
                    >
                      {r.fee.label}
                    </span>
                  </span>
                  <span className="numeral text-[17px] md:text-right">
                    {r.gradedCount} / {courseCount}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* The screen's ONE yellow band. */}
        {unassignedCount > 0 && (
          <div className="sticky bottom-0 z-10">
          <NeedsYou
            action={
              <button
                type="button"
                onClick={() => setFilter("unassigned")}
                className="shrink-0 font-mono text-[10px] font-bold tracking-[0.14em] text-ink underline-offset-4 hover:underline"
              >
                ASSIGN →
              </button>
            }
          >
            {unassignedCount === 1
              ? "1 student has no staff member walking with them."
              : `${unassignedCount} students have no staff member walking with them.`}
          </NeedsYou>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── + Add student ────────────────────────────────────────── */

/**
 * The frame puts "+ ADD STUDENT" in the masthead beside "EXPORT ROSTER", so
 * that is where it lives — not buried above the table.
 */
export function AddStudentButton({
  programId,
  options,
}: {
  programId: string;
  /** Everyone not already on this school's roster. */
  options: Array<{ id: string; name: string; email: string | null }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enrol(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/schools/enrollments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, program_id: programId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not enrol that student");
        return;
      }
      setUserId("");
      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 border border-ink bg-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white hover:bg-[#262622]"
      >
        + Add student
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-6 pt-[12vh]"
          onClick={() => setOpen(false)}
        >
          <form
            onSubmit={enrol}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[440px] border border-ink bg-white"
          >
            <div className="section-bar">
              <span className="section-bar-title">Add a student</span>
            </div>
            <div className="p-5">
              <label className="mono-label mb-2 block" htmlFor="add-student">
                Who is joining
              </label>
              <select
                id="add-student"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="w-full border border-rule-strong bg-white px-3 py-2.5 text-[14px] text-ink focus:border-ink focus:outline-none"
              >
                <option value="">Choose a person…</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                    {o.email ? ` (${o.email})` : ""}
                  </option>
                ))}
              </select>
              {options.length === 0 && (
                <p className="mt-2 text-[13px] text-[color:var(--text-tertiary)]">
                  Everyone with a Hub account is already on this school.
                </p>
              )}
              {error && <p className="mt-3 text-[13px] text-destructive">{error}</p>}
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="border border-rule-strong px-3.5 py-2 font-mono text-[9.5px] font-bold tracking-[0.12em] text-[color:var(--text-secondary)] hover:border-ink hover:text-ink"
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  disabled={busy || !userId}
                  className="bg-ink px-3.5 py-2 font-mono text-[9.5px] font-bold tracking-[0.12em] text-white hover:bg-[#262622] disabled:opacity-50"
                >
                  {busy ? "ADDING…" : "ADD TO SCHOOL"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
