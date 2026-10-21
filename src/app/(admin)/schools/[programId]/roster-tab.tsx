"use client";

/**
 * School detail · Students.
 *
 * Just the list, full width. The school-wide picture (course run, headcounts,
 * fees by track, what needs doing) lives on the Overview tab, so this screen
 * only has to answer "who is this student and what's their situation".
 *
 * Rules, so a later edit doesn't quietly undo them:
 *   · status is a dot and a word — only a problem gets colour
 *   · Track and Walking with read as text and are dropdowns on click
 *   · fees turn amber only when money is actually owed
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Chip, Initials } from "@/components/ffsa";
import type { StatusTone, StudentStatus } from "@/lib/schools/course-arrival";
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
  /** Hub-billed students: rand paid and billed, for the Overview's totals. */
  amounts?: { paid: number; total: number };
};

export type RosterRow = {
  enrollmentId: string;
  /** NULL when the person's account was deleted — the enrolment survives (migration 207). */
  userId: string | null;
  name: string;
  from: string | null;
  /** Worked out from the student's courses and arrivals (lib/schools/course-arrival). */
  status: StudentStatus;
  staffId: string | null;
  staffName: string | null;
  fee: RosterFee;
  /** Letter grades so far, graded courses on their track only (FFX is never graded). */
  grades: Array<{ code: string; letter: string }>;
  removed: boolean;
  /** The student's track (migration 221) — what the Track column shows and sets. */
  track: RosterTrack;
};

export type RosterTrack = { kind: "whole" | "segments" | "unknown"; codes: string[] };
export type TrackSegmentOption = { code: string; name: string };

/** The Track dropdown: all courses, each course alone, then the combinations under their own heading. */
export function trackOptions(segments: TrackSegmentOption[]): {
  main: Array<{ value: string; label: string }>;
  combos: Array<{ value: string; label: string }>;
} {
  const codes = segments.map((s) => s.code);
  const main = [{ value: "whole", label: "All courses" }, ...codes.map((c) => ({ value: c, label: c }))];
  const combos: Array<{ value: string; label: string }> = [];
  // Two or more courses short of all of them (all = All courses).
  for (let mask = 1; mask < (1 << codes.length) - 1; mask++) {
    const pick = codes.filter((_, i) => mask & (1 << i));
    if (pick.length >= 2) combos.push({ value: pick.join("+"), label: pick.join(" + ") });
  }
  return { main, combos };
}

export function trackValue(t: RosterTrack, segments: TrackSegmentOption[]): string {
  if (t.kind === "whole") return "whole";
  if (t.kind === "unknown" || t.codes.length === 0) return "";
  if (t.codes.length === segments.length) return "whole";
  const order = segments.map((s) => s.code);
  return [...t.codes].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join("+");
}

/** How a track reads in prose — the Overview's fee rows use it too. */
export function trackLabel(t: RosterTrack, segments: TrackSegmentOption[]): string {
  const v = trackValue(t, segments);
  if (!v) return "Track not set";
  return v === "whole" ? "All courses" : v.split("+").join(" + ");
}

export type StaffOption = { id: string; name: string };

/* ── Status ───────────────────────────────────────────────── */

export const TONE_DOT: Record<StatusTone, string> = {
  here: "#0A0A0A",
  waiting: "#B4B0A2",
  attention: "#8A6400",
  problem: "#C0392B",
  done: "#2F6620",
  gone: "#9A9689",
};

function StatusCell({ status }: { status: StudentStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[13.5px]",
        status.tone === "problem"
          ? "font-semibold text-destructive"
          : status.tone === "attention"
            ? "font-semibold text-[color:var(--amber)]"
            : status.tone === "here"
              ? "text-ink"
              : "text-[color:var(--text-secondary)]"
      )}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_DOT[status.tone] }} aria-hidden />
      {status.label}
    </span>
  );
}

/* ── Filters ──────────────────────────────────────────────── */

/** Filters the Overview's "Needs you" links can open the list on. */
export type RosterFilter =
  | "all"
  | "removed"
  | "unassigned"
  | "no_track"
  | "owing"
  | "no_plan"
  | `status:${StudentStatus["key"]}`;

const STATUS_ORDER: StudentStatus["key"][] = [
  "expected",
  "no_show",
  "waiting",
  "arrived",
  "between",
  "finished",
  "graduated",
  "left",
  "dismissed",
];

const STATUS_CHIP: Record<StudentStatus["key"], string> = {
  expected: "Not arrived",
  no_show: "No-show",
  waiting: "Waiting",
  arrived: "Arrived",
  between: "Between courses",
  finished: "Finished",
  graduated: "Graduated",
  left: "Left early",
  dismissed: "Dismissed",
};

/* ── The tab ──────────────────────────────────────────────── */

const COLS = "minmax(0,1.5fr) minmax(150px,1fr) minmax(150px,1fr) 150px";
// A school split into courses (FFX) adds the Track column.
const COLS_WITH_TRACK = "minmax(0,1.5fr) minmax(140px,1fr) minmax(130px,0.9fr) minmax(150px,1fr) 150px";

export function RosterTab({
  rows,
  staffOptions,
  trackSegments = [],
  filter,
  onFilterChange,
  feesBilledOutside,
  actions,
}: {
  rows: RosterRow[];
  staffOptions: StaffOption[];
  /** The school's courses when it's split into tracks (FFX); empty hides the Track column. */
  trackSegments?: TrackSegmentOption[];
  /** Owned by the parent so the Overview can open this list pre-filtered. */
  filter: RosterFilter;
  onFilterChange: (f: RosterFilter) => void;
  feesBilledOutside: boolean;
  /** Export controls — owned by the parent, rendered beside the search. */
  actions?: React.ReactNode;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [assigning, setAssigning] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [settingTrack, setSettingTrack] = useState<string | null>(null);
  const hasTracks = trackSegments.length > 0;
  const cols = hasTracks ? COLS_WITH_TRACK : COLS;
  const choices = useMemo(() => trackOptions(trackSegments), [trackSegments]);

  const active = useMemo(() => rows.filter((r) => !r.removed), [rows]);
  const removed = useMemo(() => rows.filter((r) => r.removed), [rows]);

  const statusCounts = useMemo(() => {
    const counts = new Map<StudentStatus["key"], number>();
    for (const r of active) counts.set(r.status.key, (counts.get(r.status.key) ?? 0) + 1);
    return STATUS_ORDER.filter((k) => counts.has(k)).map((k) => [k, counts.get(k)!] as const);
  }, [active]);

  const matches = useMemo(
    () => ({
      unassigned: (r: RosterRow) => !r.staffId,
      no_track: (r: RosterRow) => hasTracks && r.track.kind === "unknown",
      owing: (r: RosterRow) => r.fee.owed,
      no_plan: (r: RosterRow) => !feesBilledOutside && !r.fee.progress,
    }),
    [hasTracks, feesBilledOutside]
  );
  const extraChips = (
    [
      ["unassigned", "Unassigned"],
      ["no_track", "Track not set"],
      ["owing", "Owing"],
      ["no_plan", "No fee plan"],
    ] as const
  )
    .map(([key, label]) => [key, label, active.filter(matches[key]).length] as const)
    .filter(([, , n]) => n > 0);

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

  const visible = useMemo(() => {
    let base: RosterRow[];
    if (filter === "removed") base = removed;
    else if (filter === "all") base = active;
    else if (filter.startsWith("status:")) base = active.filter((r) => `status:${r.status.key}` === filter);
    else base = active.filter(matches[filter as keyof typeof matches]);
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.from ?? "").toLowerCase().includes(q)
    );
  }, [filter, query, active, removed, matches]);

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
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-rule px-5 py-3 md:px-8">
        <button type="button" onClick={() => onFilterChange("all")}>
          <Chip active={filter === "all"}>All {active.length}</Chip>
        </button>
        {statusCounts.map(([key, n]) => (
          <button key={key} type="button" onClick={() => onFilterChange(`status:${key}`)}>
            <Chip active={filter === `status:${key}`}>
              {STATUS_CHIP[key]} {n}
            </Chip>
          </button>
        ))}
        {extraChips.map(([key, label, n]) => (
          <button key={key} type="button" onClick={() => onFilterChange(key)}>
            <Chip active={filter === key}>
              {label} {n}
            </Chip>
          </button>
        ))}
        {removed.length > 0 && (
          <button type="button" onClick={() => onFilterChange("removed")}>
            <Chip active={filter === "removed"}>Removed {removed.length}</Chip>
          </button>
        )}
        <span className="flex-1" />
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find student"
            aria-label="Find student"
            className="roster-search w-[180px]"
          />
          {actions}
        </div>
      </div>

      {/* Column head — desktop only; the phone layout is a card per student. */}
      <div
        className="hidden gap-4 border-b border-ink bg-bone px-8 py-2.5 md:grid"
        style={{ gridTemplateColumns: cols }}
      >
        {["Student", "Status", ...(hasTracks ? ["Track"] : []), "Walking with", "Fees"].map((h) => (
          <span key={h} className="roster-head">{h}</span>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {visible.length === 0 ? (
          <p className="px-8 py-10 text-center text-[14px] text-[color:var(--text-secondary)]">
            {rows.length === 0 ? "No students enrolled yet" : "No students match this filter"}
          </p>
        ) : (
          visible.map((r) => (
            <div
              key={r.enrollmentId}
              className={cn(
                "block gap-4 border-b border-rule px-5 py-3.5 hover:bg-[#F7F5EE] md:grid md:items-center md:px-8",
                r.removed && "opacity-60"
              )}
              style={{ gridTemplateColumns: cols }}
            >
              <div className="group/row relative flex min-w-0 items-center gap-3">
                <Initials name={r.name} size={32} />
                <span className="flex min-w-0 flex-col">
                  {r.userId ? (
                    <Link
                      href={`/users/${r.userId}`}
                      title={r.name}
                      className="truncate text-[15px] font-bold text-ink hover:text-electric"
                    >
                      {r.name}
                    </Link>
                  ) : (
                    // No account to link to: this enrolment outlived a deleted
                    // profile (migration 207). Name only, so the student stays
                    // on the roster instead of vanishing.
                    <span
                      title={`${r.name} — account deleted`}
                      className="truncate text-[15px] font-bold text-muted-foreground"
                    >
                      {r.name}
                    </span>
                  )}
                  {r.from && (
                    <span className="truncate text-[12.5px] text-[color:var(--text-secondary)]">{r.from}</span>
                  )}
                </span>
                {/* Roll-off lives in a row menu rather than its own column. */}
                <button
                  type="button"
                  disabled={busyRow === r.enrollmentId}
                  onClick={() => setMenuFor(menuFor === r.enrollmentId ? null : r.enrollmentId)}
                  aria-label={`Actions for ${r.name}`}
                  className="ml-auto mr-1 shrink-0 px-1 font-mono text-[13px] leading-none text-[color:var(--text-tertiary)] opacity-0 hover:text-ink focus:opacity-100 group-hover/row:opacity-100"
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

              {/* Phones get the cells as a wrapped line; the grid columns only exist from md. */}
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 pl-[44px] md:mt-0 md:contents">
                <span>
                  <StatusCell status={r.status} />
                </span>
                {hasTracks && (
                  <span className="flex min-w-0 flex-col">
                    <select
                      value={trackValue(r.track, trackSegments)}
                      disabled={settingTrack === r.enrollmentId || r.removed}
                      aria-label={`Track for ${r.name}`}
                      onChange={(e) => setTrack(r, e.target.value)}
                      className={cn(
                        "select-as-text",
                        r.track.kind === "unknown" && "text-[color:var(--amber)]"
                      )}
                    >
                      {r.track.kind === "unknown" && <option value="">Not set</option>}
                      {choices.main.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                      {choices.combos.length > 0 && (
                        <optgroup label="Combinations">
                          {choices.combos.map((c) => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    {r.grades.length > 0 && (
                      <span className="mt-0.5 truncate text-[12px] text-[color:var(--text-secondary)]">
                        {r.grades.map((g) => `${g.code} ${g.letter}`).join(" · ")}
                      </span>
                    )}
                  </span>
                )}
                <span className="min-w-0">
                  <select
                    value={r.staffId ?? ""}
                    disabled={assigning === r.enrollmentId}
                    aria-label={`Staff walking with ${r.name}`}
                    onChange={(e) => assignStaff(r.enrollmentId, e.target.value || null)}
                    className={cn("select-as-text", !r.staffId && "text-[color:var(--text-tertiary)]")}
                  >
                    <option value="">Assign…</option>
                    {staffOptions.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </span>
                <span className="min-w-0">
                  {r.fee.progress && (
                    <span
                      className="mb-1 block h-1.5 w-full max-w-[130px] overflow-hidden border border-ink bg-white"
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
                      "block text-[13px]",
                      r.fee.owed ? "font-bold text-[color:var(--amber)]" : "text-[color:var(--text-secondary)]"
                    )}
                  >
                    {feeText(r.fee.label)}
                  </span>
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** The page builds fee labels in caps for the old mono column; this list reads them as a sentence. */
function feeText(label: string): string {
  if (label === "—") return label;
  const lower = label.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
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
