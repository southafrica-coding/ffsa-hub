"use client";

import { useEffect, useMemo, useState } from "react";
import { Drawer, SectionBar, StatusPill } from "@/components/ffsa";
import {
  LETTER_GRADES,
  combineReasonCopy,
  isLetterGrade,
  lmsCall,
  lmsMessage,
} from "@/lib/schools/lms-api";
import type { ClassroomPerson, QueueStudent } from "@/lib/schools/load-classroom";
import { Field, Notice, SquareButton, fieldClass } from "./fields";

type Official = { enrollmentId: string; courseId: string; letter: string | null };

type GraderRow = {
  id: string;
  billing_course_id: string | null;
  enrollment_id: string | null;
  grader_user_id: string;
  can_post_official: boolean;
};

type MarkRow = {
  grader_user_id: string;
  letter_grade: string;
  notes: string | null;
};

type Combined = { ready: boolean; letter: string | null; reason: string };

type OpenCell = { enrollmentId: string; courseId: string; studentName: string; courseCode: string; courseName: string };

function personName(person: ClassroomPerson | undefined) {
  if (!person) return "Unknown person";
  const name = `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim();
  return name || person.email || "Unknown person";
}

export function GraderQueue({
  programId,
  viewerId,
  students,
  people,
  official,
}: {
  programId: string;
  viewerId: string;
  students: QueueStudent[];
  people: ClassroomPerson[];
  official: Official[];
}) {
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [graders, setGraders] = useState<GraderRow[] | null>(null);
  const [graderNote, setGraderNote] = useState<string | null>(null);
  const [graderError, setGraderError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<OpenCell | null>(null);
  const [letters, setLetters] = useState<Record<string, string | null>>(() => {
    const map: Record<string, string | null> = {};
    for (const row of official) map[`${row.enrollmentId}:${row.courseId}`] = row.letter;
    return map;
  });

  const byId = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);

  const queue = useMemo(() => {
    const rows: OpenCell[] = [];
    for (const student of students) {
      for (const course of student.courses) {
        rows.push({
          enrollmentId: student.enrollmentId,
          courseId: course.id,
          studentName: student.name,
          courseCode: course.code,
          courseName: course.name,
        });
      }
    }
    return rows;
  }, [students]);

  const visible = queue.filter((row) => filter === "all" || !letters[`${row.enrollmentId}:${row.courseId}`]);

  function loadGraders() {
    lmsCall<{ graders: GraderRow[] }>(`/api/schools/programs/${programId}/graders`)
      .then((body) => {
        setGraders(body.graders ?? []);
        setGraderNote(null);
      })
      .catch((caught) => {
        setGraders([]);
        setGraderNote(lmsMessage(caught));
      });
  }

  useEffect(() => {
    loadGraders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programId]);

  return (
    <div>
      <SectionBar title="Queue" meta={`${visible.length}`} />
      <div className="flex flex-wrap gap-2 border-b border-rule px-5 py-3 md:px-8">
        <FilterButton on={filter === "open"} onClick={() => setFilter("open")}>
          Needs a letter
        </FilterButton>
        <FilterButton on={filter === "all"} onClick={() => setFilter("all")}>
          Everyone
        </FilterButton>
      </div>
      {visible.length === 0 ? (
        <p className="border-b border-rule px-5 py-10 text-[14px] md:px-8">
          {queue.length === 0
            ? "No graded courses have students on them yet."
            : "Every official letter on this list is posted."}
        </p>
      ) : (
        <ul>
          {visible.map((row) => {
            const letter = letters[`${row.enrollmentId}:${row.courseId}`];
            return (
              <li key={`${row.enrollmentId}:${row.courseId}`} className="border-b border-rule">
                <button
                  type="button"
                  onClick={() => setOpen(row)}
                  className="flex min-h-[52px] w-full items-center justify-between gap-4 px-5 py-3 text-left hover:bg-[#F7F5EE] md:px-8"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-display text-[17px] font-black uppercase leading-none">
                      {row.studentName}
                    </span>
                    <span className="mono-label mt-1.5 block truncate">
                      {row.courseCode} · {row.courseName}
                    </span>
                  </span>
                  {letter ? <StatusPill tone="good">{letter}</StatusPill> : <StatusPill tone="warn">No letter</StatusPill>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <MarkDrawer
        viewerId={viewerId}
        peopleById={byId}
        cell={open}
        officialLetter={open ? letters[`${open.enrollmentId}:${open.courseId}`] ?? null : null}
        onClose={() => setOpen(null)}
        onOfficial={(letter) => {
          if (!open) return;
          setLetters((current) => ({ ...current, [`${open.enrollmentId}:${open.courseId}`]: letter }));
        }}
      />

      <SectionBar title="Graders" meta={graders ? `${graders.length}` : ""} />
      <div className="space-y-4 px-5 py-5 md:px-8">
        <p className="text-[13px] leading-snug text-[#55524A]">
          A grader marks one course, one student, or both. Their mark is their own. Posting the official letter is a
          separate step, and this queue is where a school leader does it. The API does not list a grader&apos;s own
          queue apart from the school they can manage.
        </p>
        {graderNote ? <Notice tone="warn">{graderNote}</Notice> : null}
        {graderError ? <Notice tone="warn">{graderError}</Notice> : null}
        <AssignGrader
          programId={programId}
          students={students}
          people={people}
          busy={busy}
          onBusy={setBusy}
          onError={setGraderError}
          onSaved={() => {
            setGraderError(null);
            loadGraders();
          }}
        />
        {graders === null ? (
          <p className="mono-label">Loading graders…</p>
        ) : graders.length === 0 ? (
          <p className="text-[13px] text-[#55524A]">No graders assigned.</p>
        ) : (
          <ul className="border-t border-ink">
            {graders.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 border-b border-rule py-3">
                <div>
                  <div className="text-[14px]">{personName(byId.get(row.grader_user_id))}</div>
                  <p className="mono-label mt-1">
                    {scopeLabel(row, students)}
                    {row.can_post_official ? " · can post the official letter" : ""}
                  </p>
                </div>
                <SquareButton
                  tone="quiet"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setGraderError(null);
                    try {
                      await lmsCall(`/api/schools/programs/${programId}/graders?id=${row.id}`, { method: "DELETE" });
                      loadGraders();
                    } catch (caught) {
                      setGraderError(lmsMessage(caught));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Remove
                </SquareButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function scopeLabel(row: GraderRow, students: QueueStudent[]) {
  const student = students.find((item) => item.enrollmentId === row.enrollment_id);
  const course = students.flatMap((item) => item.courses).find((item) => item.id === row.billing_course_id);
  const who = row.enrollment_id ? student?.name ?? "One student" : "Every student";
  const what = row.billing_course_id ? course?.code ?? "One course" : "every course";
  return `${who} · ${what}`;
}

function FilterButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        on
          ? "min-h-11 border border-ink bg-ink px-3 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white"
          : "min-h-11 border border-rule px-3 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#55524A]"
      }
    >
      {children}
    </button>
  );
}

function AssignGrader({
  programId,
  students,
  people,
  busy,
  onBusy,
  onError,
  onSaved,
}: {
  programId: string;
  students: QueueStudent[];
  people: ClassroomPerson[];
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onError: (message: string | null) => void;
  onSaved: () => void;
}) {
  const [query, setQuery] = useState("");
  const [graderId, setGraderId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [enrollmentId, setEnrollmentId] = useState("");
  const [canPost, setCanPost] = useState(false);

  const courses = useMemo(() => {
    const map = new Map<string, { id: string; code: string; name: string }>();
    for (const student of students) {
      for (const course of student.courses) map.set(course.id, course);
    }
    return [...map.values()];
  }, [students]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return people
      .filter((person) => `${person.first_name ?? ""} ${person.last_name ?? ""} ${person.email ?? ""}`.toLowerCase().includes(q))
      .slice(0, 6);
  }, [people, query]);

  const chosen = people.find((person) => person.id === graderId);

  async function assign() {
    if (!graderId) {
      onError("Choose a person.");
      return;
    }
    if (!courseId && !enrollmentId) {
      onError("Scope the grader to a course, a student, or both.");
      return;
    }
    onBusy(true);
    onError(null);
    try {
      await lmsCall(`/api/schools/programs/${programId}/graders`, {
        method: "POST",
        body: {
          grader_user_id: graderId,
          billing_course_id: courseId || null,
          enrollment_id: enrollmentId || null,
          can_post_official: canPost,
        },
      });
      setGraderId("");
      setQuery("");
      setCanPost(false);
      onSaved();
    } catch (caught) {
      onError(lmsMessage(caught));
    } finally {
      onBusy(false);
    }
  }

  return (
    <div className="grid gap-3 border border-ink bg-bone p-3">
      <Field label="Person">
        {chosen ? (
          <div className="flex min-h-11 items-center justify-between border border-ink bg-white px-3">
            <span>{personName(chosen)}</span>
            <button type="button" className="mono-label" onClick={() => setGraderId("")}>
              Clear
            </button>
          </div>
        ) : (
          <>
            <input className={fieldClass} value={query} placeholder="Search by name" onChange={(event) => setQuery(event.target.value)} />
            {matches.length > 0 ? (
              <ul className="mt-1 border border-ink bg-white">
                {matches.map((person) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full items-center px-3 text-left text-[14px] hover:bg-bone"
                      onClick={() => {
                        setGraderId(person.id);
                        setQuery("");
                      }}
                    >
                      {personName(person)}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Course">
          <select className={fieldClass} value={courseId} onChange={(event) => setCourseId(event.target.value)}>
            <option value="">Every course</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.code} · {course.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Student">
          <select className={fieldClass} value={enrollmentId} onChange={(event) => setEnrollmentId(event.target.value)}>
            <option value="">Every student</option>
            {students.map((student) => (
              <option key={student.enrollmentId} value={student.enrollmentId}>
                {student.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-[14px]">
        <input type="checkbox" className="h-4 w-4" checked={canPost} onChange={(event) => setCanPost(event.target.checked)} />
        They can post the official letter
      </label>
      <SquareButton tone="solid" onClick={assign} disabled={busy}>
        Assign grader
      </SquareButton>
    </div>
  );
}

function MarkDrawer({
  viewerId,
  peopleById,
  cell,
  officialLetter,
  onClose,
  onOfficial,
}: {
  viewerId: string;
  peopleById: Map<string, ClassroomPerson>;
  cell: OpenCell | null;
  officialLetter: string | null;
  onClose: () => void;
  onOfficial: (letter: string) => void;
}) {
  const [marks, setMarks] = useState<MarkRow[]>([]);
  const [combined, setCombined] = useState<Combined | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [letter, setLetter] = useState("A");
  const [markNotes, setMarkNotes] = useState("");
  const [official, setOfficial] = useState("");
  const [officialNotes, setOfficialNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cell) return;
    setLetter("A");
    setMarkNotes("");
    setOfficial(officialLetter ?? "");
    setOfficialNotes("");
    setError(null);
    setNote("Loading marks…");
    const posted = officialLetter;
    lmsCall<{ marks: MarkRow[]; combined: Combined }>(
      `/api/schools/grades/marks?enrollment_id=${cell.enrollmentId}&billing_course_id=${cell.courseId}`
    )
      .then((body) => {
        setMarks(body.marks ?? []);
        setCombined(body.combined ?? null);
        const mine = (body.marks ?? []).find((mark) => mark.grader_user_id === viewerId);
        if (mine && isLetterGrade(mine.letter_grade)) setLetter(mine.letter_grade);
        if (mine?.notes) setMarkNotes(mine.notes);
        if (body.combined?.letter && !posted) setOfficial(body.combined.letter);
        setNote(null);
      })
      .catch((caught) => {
        setMarks([]);
        setCombined(null);
        setNote(lmsMessage(caught));
      });
    // Reload when the student/course changes, not when the official letter we just posted updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell, viewerId]);

  async function saveMark() {
    if (!cell || !isLetterGrade(letter)) return;
    setBusy(true);
    setError(null);
    try {
      await lmsCall(`/api/schools/grades/marks`, {
        method: "POST",
        body: {
          enrollment_id: cell.enrollmentId,
          billing_course_id: cell.courseId,
          letter_grade: letter,
          notes: markNotes.trim() || null,
        },
      });
      const body = await lmsCall<{ marks: MarkRow[]; combined: Combined }>(
        `/api/schools/grades/marks?enrollment_id=${cell.enrollmentId}&billing_course_id=${cell.courseId}`
      );
      setMarks(body.marks ?? []);
      setCombined(body.combined ?? null);
      setNote("Your mark is saved. It does not replace anyone else's, and it is not the official letter yet.");
    } catch (caught) {
      setError(lmsMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function postOfficial() {
    if (!cell || !isLetterGrade(official)) {
      setError("Choose a letter on the transcript scale.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await lmsCall(`/api/schools/grades/official`, {
        method: "POST",
        body: {
          enrollment_id: cell.enrollmentId,
          course_id: cell.courseId,
          letter_grade: official,
          notes: officialNotes.trim() || null,
        },
      });
      onOfficial(official);
      setNote("Official letter posted. The student sees it on their course and transcript.");
    } catch (caught) {
      setError(lmsMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open={!!cell} onClose={onClose} label={cell ? `${cell.courseCode} · ${cell.studentName}` : "Mark"}>
      {cell ? (
        <div className="space-y-5 px-6 py-5">
          <div>
            <h2 className="font-display text-[28px] font-black uppercase leading-none">{cell.studentName}</h2>
            <p className="mono-label mt-2">
              {cell.courseCode} · {cell.courseName}
              {officialLetter ? ` · official ${officialLetter}` : " · no official letter"}
            </p>
          </div>
          {note ? <Notice>{note}</Notice> : null}
          {error ? <Notice tone="warn">{error}</Notice> : null}
          {combined ? <p className="text-[14px]">{combineReasonCopy(combined)}</p> : null}
          {marks.length > 0 ? (
            <ul className="border-t border-ink">
              {marks.map((mark) => (
                <li key={mark.grader_user_id} className="border-b border-rule py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[14px]">
                      {personName(peopleById.get(mark.grader_user_id))}
                      {mark.grader_user_id === viewerId ? " · you" : ""}
                    </span>
                    <StatusPill>{mark.letter_grade}</StatusPill>
                  </div>
                  {mark.notes ? <p className="mt-2 text-[13px] leading-snug text-[#55524A]">{mark.notes}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}

          <Field label="Your mark">
            <select className={fieldClass} value={letter} onChange={(event) => setLetter(event.target.value)}>
              {LETTER_GRADES.map((grade) => (
                <option key={grade} value={grade}>
                  {grade}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Note" hint="School leaders can read this. The student does not see marker notes.">
            <textarea className={fieldClass} rows={3} value={markNotes} onChange={(event) => setMarkNotes(event.target.value)} />
          </Field>
          <SquareButton tone="solid" onClick={saveMark} disabled={busy}>
            Save your mark
          </SquareButton>

          <div className="border-t border-ink pt-4">
            <p className="mono-label">Official letter</p>
            <p className="mt-2 text-[13px] leading-snug text-[#55524A]">
              This is the one letter on the transcript. The grades matrix can still post through its own path.
            </p>
            <div className="mt-3 space-y-3">
              <Field label="Letter">
                <select className={fieldClass} value={official} onChange={(event) => setOfficial(event.target.value)}>
                  <option value="">Choose</option>
                  {LETTER_GRADES.map((grade) => (
                    <option key={grade} value={grade}>
                      {grade}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Transcript note">
                <textarea className={fieldClass} rows={2} value={officialNotes} onChange={(event) => setOfficialNotes(event.target.value)} />
              </Field>
              <SquareButton tone="outline" onClick={postOfficial} disabled={busy}>
                Post official letter
              </SquareButton>
            </div>
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}
