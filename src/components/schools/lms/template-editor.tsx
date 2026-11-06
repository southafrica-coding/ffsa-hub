"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SectionBar } from "@/components/ffsa";
import {
  cleanDesign,
  designFromUnknown,
  designIssues,
  emptyDesign,
  lmsCall,
  lmsMessage,
  type CourseDesign,
} from "@/lib/schools/lms-api";
import { DesignEditor } from "./design-editor";
import { Field, Notice, SquareButton, fieldClass } from "./fields";

export function TemplateEditor({
  programId,
  templateId,
  canSaveBaseWide,
}: {
  programId: string;
  templateId: string | null;
  canSaveBaseWide: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [baseWide, setBaseWide] = useState(false);
  const [savedBaseWide, setSavedBaseWide] = useState(false);
  const [scopeKnown, setScopeKnown] = useState(!templateId);
  const [lockedScope, setLockedScope] = useState<string | null>(null);
  const [design, setDesign] = useState<CourseDesign>(emptyDesign());
  const [editorKey, setEditorKey] = useState(0);
  const [note, setNote] = useState<string | null>(templateId ? "Loading the template…" : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    lmsCall<{ template: { name?: string; description?: string | null; program_id?: string | null; design?: unknown } }>(
      `/api/schools/course-templates/${templateId}`
    )
      .then((body) => {
        if (cancelled) return;
        setName(body.template.name ?? "");
        setDescription(body.template.description ?? "");
        const everySchool = body.template.program_id == null;
        setSavedBaseWide(everySchool);
        setScopeKnown(true);
        setLockedScope(everySchool ? "Every school" : "This school");
        const next = designFromUnknown(body.template.design);
        if (next) {
          setDesign(next);
          setEditorKey((key) => key + 1);
        }
        setNote(next ? null : "The saved design could not be read. Saving will replace it.");
      })
      .catch((caught) => {
        if (!cancelled) setNote(lmsMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  async function save() {
    if (templateId && !scopeKnown) return;
    if ((templateId ? savedBaseWide : baseWide) && !canSaveBaseWide) {
      setError("Only a schools manager can change a template for every school.");
      return;
    }
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 120) {
      setError("Name must be 2–120 characters.");
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
      if (!templateId) {
        const created = await lmsCall<{ template: { id: string } }>(`/api/schools/course-templates`, {
          method: "POST",
          body: {
            name: trimmed,
            description: description.trim() || null,
            program_id: baseWide ? null : programId,
            design: cleaned,
          },
        });
        router.push(`/schools/${programId}/classroom/templates/${created.template.id}`);
        router.refresh();
        return;
      }
      await lmsCall(`/api/schools/course-templates/${templateId}`, {
        method: "PATCH",
        body: { name: trimmed, description: description.trim() || null, design: cleaned },
      });
      setNote("Template saved. Courses that already copied it are unchanged.");
      router.refresh();
    } catch (caught) {
      setError(lmsMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionBar title={templateId ? "Template" : "New template"} meta={lockedScope ?? undefined} />
      <div className="space-y-4 px-5 py-5 md:px-8">
        {note ? <Notice>{note}</Notice> : null}
        {error ? <Notice tone="warn">{error}</Notice> : null}
        {templateId && scopeKnown && savedBaseWide && !canSaveBaseWide ? (
          <Notice>This template is for every school. Only a schools manager can edit it.</Notice>
        ) : (
          <>
            <div className="grid gap-4">
              <Field label="Name">
                <input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
              <Field label="Description" hint="For school leaders picking a template. Students never see the template itself.">
                <textarea className={fieldClass} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
              </Field>
            </div>
            {!templateId && canSaveBaseWide ? (
              <label className="flex min-h-11 items-center gap-3 text-[14px]">
                <input type="checkbox" className="h-4 w-4" checked={baseWide} onChange={(event) => setBaseWide(event.target.checked)} />
                Available to every school
              </label>
            ) : null}
            {!templateId && !canSaveBaseWide ? (
              <p className="text-[13px] text-[#55524A]">This template is saved for this school.</p>
            ) : null}
            <DesignEditor key={editorKey} initial={design} onChange={setDesign} />
            <SquareButton tone="solid" onClick={save} disabled={busy}>
              {busy ? "Saving…" : templateId ? "Save template" : "Create template"}
            </SquareButton>
          </>
        )}
      </div>
    </div>
  );
}
