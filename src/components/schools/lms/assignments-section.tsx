"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill, type Tone } from "@/components/ffsa";
import { ChevronLeft, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import {
  formatDue,
  formatPoints,
  fromJohannesburgInput,
  isPastDue,
  SUBMISSION_TYPES,
  toJohannesburgInput,
  type GradingCounts,
  type GradingRow,
  type GradingStatus,
  type LmsAssignment,
  type SubmissionType,
} from "@/lib/schools/lms-assignments";
import type { LmsCourse, LmsCourseTree } from "@/lib/schools/lms-content";
import { GradeDrawer } from "./grade-drawer";

// Classroom → Assignments (LMS slice 2). Leaders (canEdit) create, edit and
// publish; leaders and program staff both see submissions, grade and
// release. Mobile-first: rows become cards under md, tap targets ≥44px.

type AssignmentRow = LmsAssignment & { course_title: string; counts: GradingCounts };

const TYPE_LABEL: Record<SubmissionType, string> = { text: "Text", link: "Link", file: "File upload" };

export const STATUS_TONE: Record<GradingStatus, Tone> = {
  missing: "quiet",
  submitted: "warn",
  late: "bad",
  graded: "warn",
  released: "good",
};
export const STATUS_LABEL: Record<GradingStatus, string> = {
  missing: "Missing",
  submitted: "Submitted",
  late: "Late",
  graded: "Graded · held",
  released: "Released",
};

async function call(url: string, method = "GET", body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const message = (data.message as string) || (data.error as string) || `Request failed (${res.status})`;
  return { ok: res.ok, status: res.status, data, message };
}

type FormState = {
  id?: string;
  course_id: string;
  lesson_id: string;
  title: string;
  instructions: string;
  due_local: string;
  allow_late: boolean;
  submission_types: SubmissionType[];
  max_points: string;
};

function emptyForm(courseId: string): FormState {
  return {
    course_id: courseId,
    lesson_id: "",
    title: "",
    instructions: "",
    due_local: "",
    allow_late: true,
    submission_types: ["text"],
    max_points: "10",
  };
}

function AssignmentForm({
  programId,
  courses,
  initial,
  busy,
  onSave,
  onCancel,
}: {
  programId: string;
  courses: LmsCourse[];
  initial: FormState;
  busy: boolean;
  onSave: (form: FormState) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [lessons, setLessons] = useState<Array<{ id: string; title: string }>>([]);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!form.course_id) return;
    let live = true;
    void call(`/api/schools/programs/${programId}/lms/courses/${form.course_id}`).then((r) => {
      if (!live || !r.ok) return;
      const tree = r.data.course as LmsCourseTree;
      setLessons(tree.modules.flatMap((m) => m.lessons.map((l) => ({ id: l.id, title: `${m.title} · ${l.title}` }))));
    });
    return () => {
      live = false;
    };
  }, [programId, form.course_id]);

  const toggleType = (t: SubmissionType) =>
    set(
      "submission_types",
      form.submission_types.includes(t) ? form.submission_types.filter((x) => x !== t) : [...form.submission_types, t]
    );

  return (
    <form
      className="space-y-3 border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(form);
      }}
    >
      <label className="block text-sm font-medium">
        Title
        <Input value={form.title} onChange={(e) => set("title", e.target.value)} className="mt-1 h-11" required />
      </label>
      {!form.id && (
        <label className="block text-sm font-medium">
          Course
          <select
            value={form.course_id}
            onChange={(e) => setForm((f) => ({ ...f, course_id: e.target.value, lesson_id: "" }))}
            className="mt-1 h-11 w-full border border-input bg-white px-2 text-sm"
            required
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
                {c.published ? "" : " (draft)"}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block text-sm font-medium">
        Lesson (optional)
        <select
          value={form.lesson_id}
          onChange={(e) => set("lesson_id", e.target.value)}
          className="mt-1 h-11 w-full border border-input bg-white px-2 text-sm"
        >
          <option value="">Not tied to a lesson</option>
          {lessons.map((l) => (
            <option key={l.id} value={l.id}>
              {l.title}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium">
        Instructions
        <Textarea value={form.instructions} onChange={(e) => set("instructions", e.target.value)} rows={5} className="mt-1" />
      </label>
      <fieldset>
        <legend className="text-sm font-medium">Students can hand in</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {SUBMISSION_TYPES.map((t) => (
            <label key={t} className="flex min-h-11 items-center gap-2 border px-3 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={form.submission_types.includes(t)}
                onChange={() => toggleType(t)}
              />
              {TYPE_LABEL[t]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Due (Johannesburg time)
          <Input
            type="datetime-local"
            value={form.due_local}
            onChange={(e) => set("due_local", e.target.value)}
            className="mt-1 h-11"
          />
        </label>
        <label className="block text-sm font-medium">
          Points
          <Input
            type="number"
            inputMode="decimal"
            min="0.01"
            step="any"
            value={form.max_points}
            onChange={(e) => set("max_points", e.target.value)}
            className="mt-1 h-11"
            required
          />
        </label>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" className="h-5 w-5" checked={form.allow_late} onChange={(e) => set("allow_late", e.target.checked)} />
        Accept late work (marked Late). Off: nothing can be handed in after the due date.
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" disabled={busy || !form.title.trim() || form.submission_types.length === 0}>
          {form.id ? "Save assignment" : "Create assignment"}
        </Button>
        <Button type="button" variant="outline" className="min-h-11" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function CountsLine({ counts }: { counts: GradingCounts }) {
  const handedIn = counts.submitted + counts.late + counts.graded + counts.released;
  return (
    <p className="text-xs text-[color:var(--text-secondary)]">
      {handedIn}/{counts.total} handed in
      {counts.late > 0 && <> · <span className="text-destructive">{counts.late} late</span></>}
      {counts.graded > 0 && <> · {counts.graded} to release</>}
      {counts.released > 0 && <> · {counts.released} released</>}
      {counts.missing > 0 && <> · {counts.missing} missing</>}
    </p>
  );
}

function SubmissionsView({
  programId,
  assignment,
  onBack,
}: {
  programId: string;
  assignment: AssignmentRow;
  onBack: () => void;
}) {
  const [rows, setRows] = useState<GradingRow[] | null>(null);
  const [counts, setCounts] = useState<GradingCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openStudent, setOpenStudent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/schools/programs/${programId}/lms/assignments/${assignment.id}`;

  const load = useCallback(async () => {
    const r = await call(`${base}/submissions`);
    if (!r.ok) return setError(r.message);
    setError(null);
    setRows(r.data.rows as GradingRow[]);
    setCounts(r.data.counts as GradingCounts);
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function releaseAll() {
    setBusy(true);
    const r = await call(`${base}/release`, "POST", {});
    setBusy(false);
    if (!r.ok) return setError(r.message);
    await load();
  }

  return (
    <Card>
      <CardHeader className="space-y-2">
        <Button variant="ghost" className="min-h-11 w-fit px-2" onClick={onBack}>
          <ChevronLeft className="mr-1 h-4 w-4" /> All assignments
        </Button>
        <CardTitle className="text-base">{assignment.title}</CardTitle>
        <p className="text-sm text-[color:var(--text-secondary)]">
          {assignment.course_title} · Due {formatDue(assignment.due_at)} · {Number(assignment.max_points)} points
          {!assignment.allow_late && " · no late work"}
        </p>
        {counts && <CountsLine counts={counts} />}
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {counts && counts.graded > 0 && (
          <Button className="min-h-11" disabled={busy} onClick={() => void releaseAll()}>
            Release {counts.graded} held {counts.graded === 1 ? "grade" : "grades"}
          </Button>
        )}
        {!rows ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" />
        ) : rows.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">No students enrolled yet.</p>
        ) : (
          <>
            {/* Cards on phones */}
            <ul className="space-y-2 md:hidden">
              {rows.map((r) => (
                <li key={r.enrollment_id}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center justify-between gap-2 border px-3 py-2 text-left"
                    onClick={() => setOpenStudent(r.enrollment_id)}
                    disabled={!r.current}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{r.name}</span>
                      <span className="block text-xs text-[color:var(--text-secondary)]">
                        {r.current ? `Attempt ${r.current.attempt_no}` : "Nothing handed in"}
                        {r.current?.grade && ` · ${formatPoints(r.current.grade.points, assignment.max_points)}`}
                      </span>
                    </span>
                    <StatusPill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusPill>
                  </button>
                </li>
              ))}
            </ul>
            {/* Table from md up */}
            <table className="hidden w-full border text-sm md:table">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2">Student</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Attempt</th>
                  <th className="px-3 py-2">Handed in</th>
                  <th className="px-3 py-2">Points</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.enrollment_id}>
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2">
                      <StatusPill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusPill>
                    </td>
                    <td className="px-3 py-2">{r.current ? `${r.current.attempt_no} of ${r.attempts}` : "—"}</td>
                    <td className="px-3 py-2">{r.current?.submitted_at ? formatDue(r.current.submitted_at) : "—"}</td>
                    <td className="px-3 py-2">
                      {r.current?.grade ? formatPoints(r.current.grade.points, assignment.max_points) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.current && (
                        <Button size="sm" variant="outline" className="min-h-11" onClick={() => setOpenStudent(r.enrollment_id)}>
                          {r.current.grade ? "Review" : "Grade"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardContent>
      <GradeDrawer
        programId={programId}
        assignmentId={assignment.id}
        maxPoints={Number(assignment.max_points)}
        enrollmentId={openStudent}
        onClose={() => setOpenStudent(null)}
        onChanged={() => void load()}
      />
    </Card>
  );
}

export function AssignmentsSection({ programId, canEdit }: { programId: string; canEdit: boolean }) {
  const [assignments, setAssignments] = useState<AssignmentRow[] | null>(null);
  const [courses, setCourses] = useState<LmsCourse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const base = `/api/schools/programs/${programId}/lms`;

  const load = useCallback(async () => {
    const [a, c] = await Promise.all([call(`${base}/assignments`), canEdit ? call(`${base}/courses`) : Promise.resolve(null)]);
    if (!a.ok) {
      setError(a.message);
      setAssignments([]);
      return;
    }
    setError(null);
    setAssignments(a.data.assignments as AssignmentRow[]);
    if (c?.ok) setCourses(c.data.courses as LmsCourse[]);
  }, [base, canEdit]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = useMemo(() => assignments?.find((a) => a.id === openId) ?? null, [assignments, openId]);

  async function save(f: FormState) {
    setBusy(true);
    const payload = {
      title: f.title,
      instructions: f.instructions,
      due_at: fromJohannesburgInput(f.due_local),
      allow_late: f.allow_late,
      submission_types: f.submission_types,
      max_points: f.max_points,
      lesson_id: f.lesson_id || null,
    };
    const r = f.id
      ? await call(`${base}/assignments/${f.id}`, "PATCH", payload)
      : await call(`${base}/assignments`, "POST", { ...payload, course_id: f.course_id });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setForm(null);
    await load();
  }

  async function togglePublish(a: AssignmentRow) {
    setBusy(true);
    const r = await call(`${base}/assignments/${a.id}`, "PATCH", { published: !a.published });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    await load();
  }

  async function remove(a: AssignmentRow) {
    if (!window.confirm(`Delete "${a.title}"? This cannot be undone.`)) return;
    setBusy(true);
    const r = await call(`${base}/assignments/${a.id}`, "DELETE");
    setBusy(false);
    if (!r.ok) return setError(r.message);
    await load();
  }

  if (open) {
    return <SubmissionsView programId={programId} assignment={open} onBack={() => { setOpenId(null); void load(); }} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Assignments</CardTitle>
        <p className="text-sm text-muted-foreground">
          Set work for enrolled students, then grade and release it.
          {canEdit ? " Leaders and program staff can both grade." : " You can grade and release; leaders set the assignments."}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!assignments ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" />
        ) : assignments.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">No assignments yet.</p>
        ) : (
          <ul className="space-y-2">
            {assignments.map((a) => (
              <li key={a.id} className="border px-3 py-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button type="button" className="min-h-11 min-w-0 flex-1 text-left" onClick={() => setOpenId(a.id)}>
                    <span className="block text-sm font-medium underline-offset-2 hover:underline">{a.title}</span>
                    <span className="block text-xs text-[color:var(--text-secondary)]">
                      {a.course_title} · Due {formatDue(a.due_at)}
                      {isPastDue(a.due_at) && !a.allow_late && " · closed"} · {Number(a.max_points)} pts ·{" "}
                      {a.submission_types.map((t) => TYPE_LABEL[t]).join(", ")}
                    </span>
                    <CountsLine counts={a.counts} />
                  </button>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void togglePublish(a)}
                        disabled={busy}
                        aria-pressed={a.published}
                        aria-label={`${a.published ? "Unpublish" : "Publish"} ${a.title}`}
                        className="flex min-h-11 items-center disabled:opacity-50"
                      >
                        <StatusPill tone={a.published ? "good" : "quiet"}>{a.published ? "Published" : "Draft"}</StatusPill>
                      </button>
                      <Button
                        variant="ghost"
                        className="h-11 w-11 p-0"
                        disabled={busy}
                        onClick={() =>
                          setForm({
                            id: a.id,
                            course_id: a.course_id,
                            lesson_id: a.lesson_id ?? "",
                            title: a.title,
                            instructions: a.instructions ?? "",
                            due_local: toJohannesburgInput(a.due_at),
                            allow_late: a.allow_late,
                            submission_types: a.submission_types,
                            max_points: String(a.max_points),
                          })
                        }
                      >
                        <Pencil className="h-4 w-4" />
                        <span className="sr-only">Edit {a.title}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-11 w-11 p-0 text-destructive hover:text-destructive"
                        disabled={busy}
                        onClick={() => void remove(a)}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Delete {a.title}</span>
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canEdit &&
          (form ? (
            <AssignmentForm
              key={form.id ?? "new"}
              programId={programId}
              courses={courses}
              initial={form}
              busy={busy}
              onSave={save}
              onCancel={() => setForm(null)}
            />
          ) : courses.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add a classroom course above before setting assignments.</p>
          ) : (
            <Button className="min-h-11" onClick={() => setForm(emptyForm(courses[0].id))}>
              <Plus className="mr-1 h-4 w-4" /> New assignment
            </Button>
          ))}
      </CardContent>
    </Card>
  );
}
