"use client";

/**
 * Frame 14b — courses & grades.
 *
 * A matrix, not a form per student. The single rule that matters here: an
 * ungraded cell is EMPTY WHITE. No dash, no placeholder, no "not set". The
 * holes are the point — they are how a school leader sees what is outstanding
 * at a glance, and anything drawn in them destroys that reading.
 *
 * Every cell is a select that edits in place and saves on change, so there is
 * no "Save all" button to forget.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Initials, SectionBar } from "@/components/ffsa";
import { gradeToPoints } from "@/services/schools";
import { cn } from "@/lib/utils/cn";

export const LETTER_GRADES = [
  "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F", "W", "I", "P",
] as const;

export type MatrixCourse = {
  id: string;
  code: string;
  name: string;
  credit_hours: number;
};

export type MatrixStudent = {
  enrollmentId: string;
  /** NULL when the person's account was deleted (migration 207). */
  userId: string | null;
  name: string;
};

export type MatrixGrade = {
  enrollment_id: string;
  course_id: string;
  letter_grade: string | null;
};

/** Mean grade point across the graded cells, printed back as a letter. */
function averageLetter(letters: Array<string | null>): string {
  const points = letters
    .map((l) => (l ? gradeToPoints(l) : null))
    .filter((p): p is number => p !== null);
  if (points.length === 0) return "";
  const mean = points.reduce((a, b) => a + b, 0) / points.length;
  // Nearest letter by grade point, so the average reads in the same alphabet
  // as the cells beside it rather than as a stray decimal.
  let best = "F";
  let bestGap = Infinity;
  for (const letter of LETTER_GRADES) {
    const p = gradeToPoints(letter);
    if (p === null) continue;
    const gap = Math.abs(p - mean);
    if (gap < bestGap) {
      bestGap = gap;
      best = letter;
    }
  }
  return best;
}

export function GradesMatrix({
  programCode,
  courses,
  students,
  grades,
  lastEdit,
  programId,
}: {
  programCode: string;
  courses: MatrixCourse[];
  students: MatrixStudent[];
  grades: MatrixGrade[];
  lastEdit: { at: string; by: string } | null;
  programId: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Optimistic overlay so a cell shows its new letter before the refresh lands.
  const [edits, setEdits] = useState<Record<string, string | null>>({});
  const [showTranscripts, setShowTranscripts] = useState(false);

  const key = (enrollmentId: string, courseId: string) => `${enrollmentId}:${courseId}`;

  const server = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const g of grades) map[key(g.enrollment_id, g.course_id)] = g.letter_grade;
    return map;
  }, [grades]);

  function gradeFor(enrollmentId: string, courseId: string): string {
    const k = key(enrollmentId, courseId);
    const edited = edits[k];
    if (edited !== undefined) return edited ?? "";
    return server[k] ?? "";
  }

  async function save(enrollmentId: string, courseId: string, letter: string) {
    const k = key(enrollmentId, courseId);
    const previous = edits[k];
    setEdits((prev) => ({ ...prev, [k]: letter || null }));
    setSaving(k);
    setError(null);
    try {
      const res = await fetch("/api/schools/grades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grades: [{ enrollment_id: enrollmentId, course_id: courseId, letter_grade: letter || null }],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not save that grade");
        // Put the cell back rather than leave a lie on screen.
        setEdits((prev) => ({ ...prev, [k]: previous === undefined ? (server[k] ?? null) : previous }));
        return;
      }
      router.refresh();
    } catch {
      setError("Could not save that grade — check your connection");
      setEdits((prev) => ({ ...prev, [k]: previous === undefined ? (server[k] ?? null) : previous }));
    } finally {
      setSaving(null);
    }
  }

  /**
   * The matrix as it stands, straight to a file. Built here rather than server
   * side because what a leader wants to export is exactly what they are
   * looking at, optimistic cells included.
   */
  function exportCsv() {
    const head = ["Student", ...courses.map((c) => c.code), "Average"];
    const body = students.map((s) => {
      const letters = courses.map((c) => gradeFor(s.enrollmentId, c.id));
      return [s.name, ...letters, averageLetter(letters.map((l) => l || null))];
    });
    const csv = [head, ...body]
      .map((row) => row.map((cell) => JSON.stringify(String(cell))).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${programCode}-grades.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (courses.length === 0) {
    return (
      <div className="border border-ink">
        <SectionBar title={`${programCode} · grades`} />
        <div className="space-y-3 px-6 py-12 text-center">
          <p className="mono-label">
            Add billing courses on the Courses tab first
          </p>
          <p className="mono-label">
            Classroom courses don&apos;t create grade columns
          </p>
        </div>
      </div>
    );
  }

  if (students.length === 0) {
    return (
      <div className="border border-ink">
        <SectionBar title={`${programCode} · grades`} />
        <p className="mono-label px-6 py-12 text-center">
          Enrol students before grading
        </p>
      </div>
    );
  }

  const totalCredits = courses.reduce((sum, c) => sum + (c.credit_hours ?? 0), 0);
  const cols = `250px repeat(${courses.length}, minmax(74px, 1fr)) 96px`;

  return (
    <div className="border border-ink">
      <SectionBar
        title={`${programCode} · grades`}
        meta={`${totalCredits} CREDIT HOURS · ${courses.length} ${courses.length === 1 ? "COURSE" : "COURSES"}`}
      />

      {/* The matrix is wide by nature — it scrolls inside its own box rather
          than pushing the page sideways. */}
      <div className="overflow-x-auto">
        <div className="min-w-[820px]">
          <div className="grid border-b border-ink bg-bone" style={{ gridTemplateColumns: cols }}>
            <span className="mono-label px-5 py-3">Student</span>
            {courses.map((c) => (
              <div key={c.id} className="border-l border-rule px-3 py-2.5">
                <div className="font-display text-[18px] font-black leading-none text-ink">{c.code}</div>
                <div className="mt-0.5 truncate text-[11px] text-[color:var(--text-secondary)]">{c.name}</div>
                <div className="mt-1 font-mono text-[8.5px] font-bold tracking-[0.1em] text-[color:var(--text-quiet)]">
                  {c.credit_hours} CR
                </div>
              </div>
            ))}
            <span className="mono-label border-l border-ink px-3.5 py-3 text-right">Avg</span>
          </div>

          {students.map((s) => {
            const letters = courses.map((c) => gradeFor(s.enrollmentId, c.id) || null);
            return (
              <div
                key={s.enrollmentId}
                className="grid items-stretch border-b border-rule hover:bg-[#F7F5EE]"
                style={{ gridTemplateColumns: cols }}
              >
                <div className="flex min-w-0 items-center gap-3 px-5 py-2.5">
                  <Initials name={s.name} size={28} />
                  <span className="truncate text-[14px] font-bold text-ink">{s.name}</span>
                </div>

                {courses.map((c) => {
                  const letter = gradeFor(s.enrollmentId, c.id);
                  const k = key(s.enrollmentId, c.id);
                  return (
                    <div
                      key={c.id}
                      className={cn(
                        "relative flex cursor-pointer items-center justify-center border-l border-rule hover:bg-yellow",
                        // Ungraded stays plain white. Nothing is drawn in it.
                        letter.startsWith("A") ? "bg-bone-2" : "bg-white",
                        saving === k && "opacity-50"
                      )}
                    >
                      <span className="numeral pointer-events-none text-[20px] leading-none">
                        {letter}
                      </span>
                      <select
                        value={letter}
                        disabled={saving === k}
                        aria-label={`${c.code} grade for ${s.name}`}
                        onChange={(e) => save(s.enrollmentId, c.id, e.target.value)}
                        className="absolute inset-0 cursor-pointer opacity-0"
                      >
                        <option value=""> </option>
                        {LETTER_GRADES.map((g) => (
                          <option key={g} value={g}>{g}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}

                <div className="flex items-center justify-end border-l border-ink px-3.5">
                  <span className="numeral text-[20px] leading-none">{averageLetter(letters)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink bg-bone px-6 py-3">
        <span className="font-mono text-[10px] font-bold tracking-[0.12em] text-[color:var(--text-secondary)]">
          {error ? (
            <span className="text-destructive">{error.toUpperCase()}</span>
          ) : lastEdit ? (
            `CHANGES SAVE AS YOU GO · LAST EDIT ${lastEdit.at} BY ${lastEdit.by}`
          ) : (
            "CHANGES SAVE AS YOU GO · NOTHING GRADED YET"
          )}
        </span>
        <div className="relative flex gap-2">
          <button
            type="button"
            onClick={exportCsv}
            className="border border-ink px-3.5 py-2 font-mono text-[9.5px] font-bold tracking-[0.12em] text-ink hover:bg-bone-2"
          >
            EXPORT CSV
          </button>
          <button
            type="button"
            onClick={() => setShowTranscripts((v) => !v)}
            aria-expanded={showTranscripts}
            className="bg-ink px-3.5 py-2 font-mono text-[9.5px] font-bold tracking-[0.12em] text-white hover:bg-[#262622]"
          >
            PRINT TRANSCRIPTS
          </button>
          {/* One PDF per student — the transcript endpoint renders a single
              enrolment, so the list is the honest form of "print transcripts"
              rather than a bulk button that silently does one. */}
          {showTranscripts && (
            <div className="absolute bottom-full right-0 z-20 mb-2 max-h-[280px] w-[260px] overflow-y-auto border border-ink bg-white">
              <div className="mono-label border-b border-rule bg-bone px-3 py-2">
                Transcript · pick a student
              </div>
              {/* The transcript endpoint is keyed on the user, so a student
                  whose account was deleted (migration 207) has nothing to
                  render — list them greyed rather than linking to a 404. */}
              {students.map((s) =>
                s.userId ? (
                  <a
                    key={s.enrollmentId}
                    href={`/api/schools/transcript?userId=${s.userId}&programId=${programId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block border-b border-rule px-3 py-2 text-[13px] font-semibold text-ink hover:bg-[#F7F5EE]"
                  >
                    {s.name}
                  </a>
                ) : (
                  <span
                    key={s.enrollmentId}
                    title="No account — transcript unavailable"
                    className="block border-b border-rule px-3 py-2 text-[13px] font-semibold text-muted-foreground"
                  >
                    {s.name}
                  </span>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
