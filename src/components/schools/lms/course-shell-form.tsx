"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  classroomHref,
  feeSetupHref,
  learningCourseIssues,
  lmsCall,
  lmsMessage,
  type LearningCourseBody,
} from "@/lib/schools/lms-api";
import type { ClassroomCourse } from "@/lib/schools/load-classroom";
import { candidateName, type GraderCandidate } from "@/lib/schools/lms-api";
import { Field, Notice, SquareButton, fieldClass } from "./fields";
import { useGraderCandidates } from "./use-grader-candidates";

function personName(person: GraderCandidate) {
  return candidateName(person, "Current lead");
}

function formLeadOptions(people: GraderCandidate[], leadId: string | null): GraderCandidate[] {
  if (!leadId || people.some((person) => person.id === leadId)) return people;
  return [{ id: leadId, first_name: null, last_name: null, preferred_name: null }, ...people];
}

function fromCourse(course: ClassroomCourse | null): LearningCourseBody {
  return {
    code: course?.code ?? "",
    name: course?.name ?? "",
    description: course?.description ?? null,
    notes: course?.notes ?? null,
    scope: course?.scope ?? "segment",
    sequence: course?.sequence ?? 0,
    status: course?.status ?? "upcoming",
    start_date: course?.start_date ?? null,
    end_date: course?.end_date ?? null,
    arrival_date: course?.arrival_date ?? null,
    credit_hours: course?.credit_hours ?? 0,
    graded: course?.graded === true,
    lead_staff_id: course?.lead_staff_id ?? null,
  };
}

export function CourseShellForm({
  programId,
  course,
}: {
  programId: string;
  course: ClassroomCourse | null;
}) {
  const router = useRouter();
  const { people, note: peopleNote } = useGraderCandidates(programId);
  const [form, setForm] = useState<LearningCourseBody>(() => fromCourse(course));
  const leadOptions = formLeadOptions(people, form.lead_staff_id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof LearningCourseBody>(key: K, value: LearningCourseBody[K]) {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    const issues = learningCourseIssues(form);
    if (issues) {
      setError(issues);
      return;
    }
    setBusy(true);
    setError(null);
    const body: LearningCourseBody = {
      ...form,
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      description: form.description?.trim() || null,
      notes: form.notes?.trim() || null,
    };
    try {
      if (course) {
        await lmsCall(`/api/schools/programs/${programId}/learning-courses/${course.id}`, {
          method: "PATCH",
          body,
        });
        setSaved(true);
        router.refresh();
      } else {
        const created = await lmsCall<{ course: { id: string } }>(
          `/api/schools/programs/${programId}/learning-courses`,
          { method: "POST", body }
        );
        router.push(`/schools/${programId}/classroom/${created.course.id}`);
        router.refresh();
      }
    } catch (caught) {
      setError(lmsMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!course) return;
    if (!confirm(`Delete ${course.name}? Fee items, billing plans, and transcript grades block this.`)) return;
    setBusy(true);
    setError(null);
    try {
      await lmsCall(`/api/schools/programs/${programId}/learning-courses/${course.id}`, { method: "DELETE" });
      router.push(classroomHref(programId));
      router.refresh();
    } catch (caught) {
      setError(lmsMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 px-5 py-5 md:px-8">
      <p className="text-[13px] leading-snug text-[#55524A]">
        This saves the training course. It does not create fee items.{" "}
        {course ? (
          <Link className="underline" href={feeSetupHref(programId, course.id)}>
            Set up fees in Finance
          </Link>
        ) : (
          <Link className="underline" href={feeSetupHref(programId)}>
            Fees for the school stay in Finance
          </Link>
        )}
        .
      </p>
      {error ? <Notice tone="warn">{error}</Notice> : null}
      {saved ? <Notice>Course details saved.</Notice> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code">
          <input className={fieldClass} value={form.code} onChange={(event) => set("code", event.target.value)} />
        </Field>
        <Field label="Name">
          <input className={fieldClass} value={form.name} onChange={(event) => set("name", event.target.value)} />
        </Field>
        <Field label="Scope">
          <select className={fieldClass} value={form.scope} onChange={(event) => set("scope", event.target.value as LearningCourseBody["scope"])}>
            <option value="segment">Segment</option>
            <option value="full_program">Whole programme</option>
          </select>
        </Field>
        <Field label="Status">
          <select className={fieldClass} value={form.status} onChange={(event) => set("status", event.target.value as LearningCourseBody["status"])}>
            <option value="upcoming">Upcoming</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </select>
        </Field>
        <Field label="Sequence" hint="0 comes first.">
          <input className={fieldClass} type="number" min={0} max={999} value={form.sequence} onChange={(event) => set("sequence", Number(event.target.value))} />
        </Field>
        <Field label="Credit hours" hint="Weights the transcript. 0 to 40.">
          <input className={fieldClass} type="number" min={0} max={40} value={form.credit_hours} onChange={(event) => set("credit_hours", Number(event.target.value))} />
        </Field>
        <Field label="Start">
          <input className={fieldClass} type="date" value={form.start_date ?? ""} onChange={(event) => set("start_date", event.target.value || null)} />
        </Field>
        <Field label="End">
          <input className={fieldClass} type="date" value={form.end_date ?? ""} onChange={(event) => set("end_date", event.target.value || null)} />
        </Field>
        <Field label="Arrival" hint="Cannot be after the course starts.">
          <input className={fieldClass} type="date" value={form.arrival_date ?? ""} onChange={(event) => set("arrival_date", event.target.value || null)} />
        </Field>
        <Field label="Course leader" hint={peopleNote ?? "People who can lead or grade this school."}>
          <select className={fieldClass} value={form.lead_staff_id ?? ""} onChange={(event) => set("lead_staff_id", event.target.value || null)}>
            <option value="">No one named</option>
            {leadOptions.map((person) => (
              <option key={person.id} value={person.id}>
                {personName(person)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-[14px]">
        <input type="checkbox" className="h-4 w-4" checked={form.graded} onChange={(event) => set("graded", event.target.checked)} />
        Students get a grade for this course
      </label>
      <Field label="Description" hint="Students can read this on the course home.">
        <textarea className={fieldClass} rows={3} value={form.description ?? ""} onChange={(event) => set("description", event.target.value)} />
      </Field>
      <Field label="Notes" hint="For school leaders. Students do not see this field.">
        <textarea className={fieldClass} rows={2} value={form.notes ?? ""} onChange={(event) => set("notes", event.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <SquareButton tone="solid" onClick={save} disabled={busy}>
          {busy ? "Saving…" : course ? "Save course details" : "Create course"}
        </SquareButton>
        {course ? (
          <SquareButton tone="quiet" onClick={remove} disabled={busy}>
            Delete course
          </SquareButton>
        ) : null}
      </div>
    </div>
  );
}
