"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SectionBar } from "@/components/ffsa";
import {
  cleanDesign,
  designFromUnknown,
  designIssues,
  emptyDesign,
  lmsCall,
  lmsMessage,
  summaryLine,
  summarizeDesign,
  type CourseDesign,
} from "@/lib/schools/lms-api";
import type { ClassroomCourse } from "@/lib/schools/load-classroom";
import { CourseShellForm } from "./course-shell-form";
import { DesignEditor } from "./design-editor";
import { Field, Notice, SquareButton, fieldClass } from "./fields";
import { StudentCourseBody } from "./student-course-view";

type TemplateOption = { id: string; name: string; program_id: string | null };

export function CourseBuilder({
  programId,
  programName,
  course,
}: {
  programId: string;
  programName: string;
  course: ClassroomCourse;
}) {
  const router = useRouter();
  const [design, setDesign] = useState<CourseDesign>(emptyDesign());
  const [editorKey, setEditorKey] = useState(0);
  const [outlineNote, setOutlineNote] = useState<string | null>("Loading the classroom…");
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState(false);
  const dirty = useRef(false);

  function replaceDesign(next: CourseDesign) {
    setDesign(next);
    setEditorKey((key) => key + 1);
  }

  useEffect(() => {
    let cancelled = false;
    lmsCall<{ outline: { design?: unknown } | null }>(
      `/api/schools/programs/${programId}/learning-courses/${course.id}/outline`
    )
      .then((body) => {
        if (cancelled || dirty.current) return;
        const next = designFromUnknown(body.outline?.design);
        if (next) replaceDesign(next);
        setOutlineNote(
          body.outline
            ? next
              ? null
              : "The saved classroom could not be read. Saving will replace it."
            : "No classroom saved on this course yet."
        );
      })
      .catch((caught) => {
        if (!cancelled) setOutlineNote(lmsMessage(caught));
      });
    lmsCall<{ templates: TemplateOption[] }>(`/api/schools/course-templates?program_id=${programId}`)
      .then((body) => {
        if (!cancelled) setTemplates(body.templates ?? []);
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [programId, course.id]);

  async function saveDesign() {
    const cleaned = cleanDesign(design);
    const issues = designIssues(cleaned);
    if (issues) {
      setError(issues);
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await lmsCall(`/api/schools/programs/${programId}/learning-courses/${course.id}/outline`, {
        method: "PUT",
        body: { design: cleaned },
      });
      setSaved(true);
      setOutlineNote(null);
      router.refresh();
    } catch (caught) {
      setError(lmsMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function copyTemplate() {
    if (!templateId) return;
    if (!confirm("This replaces the classroom on this course. The template itself stays as it is.")) return;
    setBusy(true);
    setError(null);
    try {
      const body = await lmsCall<{ outline: { design?: unknown } }>(
        `/api/schools/programs/${programId}/learning-courses/${course.id}/outline`,
        { method: "PUT", body: { template_id: templateId } }
      );
      const next = designFromUnknown(body.outline?.design);
      if (next) replaceDesign(next);
      setSaved(true);
      setOutlineNote("Copied from the template. Later edits to the template will not change this course.");
    } catch (caught) {
      setError(lmsMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate() {
    const name = templateName.trim();
    if (name.length < 2) {
      setError("Name the template with at least 2 characters.");
      return;
    }
    const cleaned = cleanDesign(design);
    const issues = designIssues(cleaned);
    if (issues) {
      setError(issues);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await lmsCall(`/api/schools/course-templates`, {
        method: "POST",
        body: { name, program_id: programId, design: cleaned },
      });
      setTemplateName("");
      setSaved(true);
      setOutlineNote("Saved a copy in this school's template library. The course itself is unchanged until you save the classroom.");
    } catch (caught) {
      setError(lmsMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionBar title="Course details" meta={programName} />
      <CourseShellForm programId={programId} course={course} />

      <SectionBar title="Classroom" meta={summaryLine(summarizeDesign(cleanDesign(design)))} />
      <div className="space-y-4 px-5 py-5 md:px-8">
        {outlineNote ? <Notice>{outlineNote}</Notice> : null}
        {error ? <Notice tone="warn">{error}</Notice> : null}
        {saved ? <Notice>Saved.</Notice> : null}
        <div className="flex flex-wrap gap-2">
          <SquareButton tone="solid" onClick={saveDesign} disabled={busy}>
            {busy ? "Saving…" : "Save classroom"}
          </SquareButton>
          <SquareButton tone="outline" onClick={() => setPreview((value) => !value)}>
            {preview ? "Back to editing" : "Student view"}
          </SquareButton>
        </div>

        <div className="grid gap-3 border border-rule bg-bone p-3 md:grid-cols-[1fr_auto] md:items-end">
          <Field label="Copy a template onto this course">
            <select className={fieldClass} value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
              <option value="">Choose a template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                  {template.program_id ? "" : " · every school"}
                </option>
              ))}
            </select>
          </Field>
          <SquareButton tone="outline" onClick={copyTemplate} disabled={busy || !templateId}>
            Copy template
          </SquareButton>
        </div>

        {preview ? (
          <div className="border border-ink">
            <StudentCourseBody
              course={{
                code: course.code,
                name: course.name,
                startDate: course.start_date,
                graded: course.graded,
              }}
              design={cleanDesign(design)}
            />
          </div>
        ) : (
          <DesignEditor
            key={editorKey}
            initial={design}
            onChange={(next) => {
              dirty.current = true;
              setDesign(next);
            }}
          />
        )}

        <div className="grid gap-3 border border-rule p-3 md:grid-cols-[1fr_auto] md:items-end">
          <Field label="Save a copy in the template library" hint="This school's library. The course keeps its own copy.">
            <input
              className={fieldClass}
              value={templateName}
              placeholder="Template name"
              onChange={(event) => setTemplateName(event.target.value)}
            />
          </Field>
          <SquareButton tone="outline" onClick={saveTemplate} disabled={busy}>
            Save as template
          </SquareButton>
        </div>
      </div>
    </div>
  );
}
