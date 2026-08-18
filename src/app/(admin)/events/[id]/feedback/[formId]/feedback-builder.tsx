"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FEEDBACK_FIELD_TYPES,
  isChoiceType,
  newFeedbackField,
  newLocalId,
  type FeedbackField,
  type FeedbackFieldType,
  type FeedbackSchema,
  type FeedbackSection,
} from "@/lib/feedback/schema";
import { QuestionInput } from "@/components/feedback/question-input";

export type FeedbackFormMeta = {
  id: string;
  slug: string;
  title: string;
  intro: string | null;
  status: "draft" | "open" | "closed";
  is_anonymous: boolean;
  closes_at: string | null;
  thank_you_heading: string | null;
  thank_you_message: string | null;
};

export function FeedbackBuilder({
  eventId,
  form,
  initialSchema,
  responseCount,
}: {
  eventId: string;
  form: FeedbackFormMeta;
  initialSchema: FeedbackSchema;
  responseCount: number;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(form.title);
  const [intro, setIntro] = useState(form.intro ?? "");
  const [schema, setSchema] = useState<FeedbackSchema>(initialSchema);
  const [isAnonymous, setIsAnonymous] = useState(form.is_anonymous);
  const [status, setStatus] = useState(form.status);
  const [closesAt, setClosesAt] = useState(form.closes_at?.slice(0, 10) ?? "");
  const [tyHeading, setTyHeading] = useState(form.thank_you_heading ?? "");
  const [tyMessage, setTyMessage] = useState(form.thank_you_message ?? "");
  const [tab, setTab] = useState<"questions" | "preview">("questions");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Every edit path funnels through here so the unsaved-changes flag can
  // never drift from the actual state.
  function mutate(next: FeedbackSchema) {
    setSchema(next);
    setDirty(true);
  }
  function touch<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setDirty(true);
    };
  }

  // ── section helpers ───────────────────────────────────────
  function updateSection(sectionId: string, patch: Partial<FeedbackSection>) {
    mutate({
      ...schema,
      sections: schema.sections.map((s) =>
        s.id === sectionId ? { ...s, ...patch } : s
      ),
    });
  }
  function addSection() {
    mutate({
      ...schema,
      sections: [
        ...schema.sections,
        { id: newLocalId(), title: "New section", description: null, fields: [] },
      ],
    });
  }
  function removeSection(sectionId: string) {
    mutate({
      ...schema,
      sections: schema.sections.filter((s) => s.id !== sectionId),
    });
  }
  function moveSection(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= schema.sections.length) return;
    const next = [...schema.sections];
    [next[idx], next[target]] = [next[target], next[idx]];
    mutate({ ...schema, sections: next });
  }

  // ── question helpers ──────────────────────────────────────
  function addField(sectionId: string, type: FeedbackFieldType) {
    const section = schema.sections.find((s) => s.id === sectionId);
    if (!section) return;
    updateSection(sectionId, { fields: [...section.fields, newFeedbackField(type)] });
  }
  function updateField(
    sectionId: string,
    fieldId: string,
    patch: Partial<FeedbackField>
  ) {
    const section = schema.sections.find((s) => s.id === sectionId);
    if (!section) return;
    updateSection(sectionId, {
      fields: section.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)),
    });
  }
  function removeField(sectionId: string, fieldId: string) {
    const section = schema.sections.find((s) => s.id === sectionId);
    if (!section) return;
    updateSection(sectionId, {
      fields: section.fields.filter((f) => f.id !== fieldId),
    });
  }
  function duplicateField(sectionId: string, fieldId: string) {
    const section = schema.sections.find((s) => s.id === sectionId);
    const field = section?.fields.find((f) => f.id === fieldId);
    if (!section || !field) return;
    const idx = section.fields.findIndex((f) => f.id === fieldId);
    const copy = { ...field, id: newLocalId() };
    const fields = [...section.fields];
    fields.splice(idx + 1, 0, copy);
    updateSection(sectionId, { fields });
  }
  function moveField(sectionId: string, idx: number, dir: -1 | 1) {
    const section = schema.sections.find((s) => s.id === sectionId);
    if (!section) return;
    const target = idx + dir;
    if (target < 0 || target >= section.fields.length) return;
    const fields = [...section.fields];
    [fields[idx], fields[target]] = [fields[target], fields[idx]];
    updateSection(sectionId, { fields });
  }

  // Changing type has to reshape the field: a dropdown without options,
  // or a scale carrying stale option strings, both render broken.
  function changeType(sectionId: string, fieldId: string, type: FeedbackFieldType) {
    const section = schema.sections.find((s) => s.id === sectionId);
    const field = section?.fields.find((f) => f.id === fieldId);
    if (!field) return;
    const fresh = newFeedbackField(type);
    updateField(sectionId, fieldId, {
      type,
      options: isChoiceType(type) ? (field.options ?? fresh.options) : undefined,
      scaleMin: fresh.scaleMin,
      scaleMax: fresh.scaleMax,
      minLabel: fresh.minLabel,
      maxLabel: fresh.maxLabel,
    });
  }

  // ── save ──────────────────────────────────────────────────
  async function save(overrides?: { status?: "draft" | "open" | "closed" }) {
    const nextStatus = overrides?.status ?? status;

    // An open form with no questions is a dead end for whoever clicks the
    // link, so opening is blocked until there's something to answer.
    if (nextStatus === "open" && !schema.sections.some((s) => s.fields.length)) {
      setErr("Add at least one question before opening the form.");
      return;
    }
    const untitled = schema.sections
      .flatMap((s) => s.fields)
      .filter((f) => !f.label.trim());
    if (nextStatus === "open" && untitled.length) {
      setErr(
        `${untitled.length} question${untitled.length === 1 ? " has" : "s have"} no wording yet.`
      );
      return;
    }

    setBusy(true);
    setErr(null);
    setMsg(null);
    const res = await fetch(`/api/events/${eventId}/feedback/${form.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        intro,
        schema,
        isAnonymous,
        status: nextStatus,
        closesAt: closesAt || null,
        thankYouHeading: tyHeading,
        thankYouMessage: tyMessage,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to save");
      return;
    }
    setStatus(nextStatus);
    setDirty(false);
    setMsg(
      nextStatus !== status
        ? nextStatus === "open"
          ? "Saved — the form is open and the link is live."
          : nextStatus === "closed"
            ? "Saved — the form is closed to new responses."
            : "Saved as a draft."
        : "Saved."
    );
    router.refresh();
  }

  async function destroy() {
    const warning =
      responseCount > 0
        ? `Delete this form and all ${responseCount} response${responseCount === 1 ? "" : "s"}? This cannot be undone.`
        : "Delete this feedback form?";
    if (!confirm(warning)) return;
    setBusy(true);
    const res = await fetch(`/api/events/${eventId}/feedback/${form.id}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to delete");
      return;
    }
    router.push(`/events/${eventId}?tab=feedback`);
  }

  const questionCount = schema.sections.reduce((n, s) => n + s.fields.length, 0);

  return (
    <div className="space-y-6">
      {/* ── action bar ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border border-ink px-5 py-4">
        <div className="flex items-center gap-1.5">
          {(["questions", "preview"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs uppercase tracking-[0.12em] border ${
                tab === t
                  ? "bg-ink text-white border-ink"
                  : "border-rule hover:bg-[color:var(--surface-2)]"
              }`}
            >
              {t === "questions" ? `Questions (${questionCount})` : "Preview"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && (
            <span className="text-xs text-[color:var(--text-tertiary)]">
              Unsaved changes
            </span>
          )}
          {status !== "open" && (
            <button
              type="button"
              onClick={() => save({ status: "open" })}
              disabled={busy}
              className="px-3 py-1.5 border border-ink text-xs hover:bg-[color:var(--surface-2)] disabled:opacity-50"
            >
              Save &amp; open form
            </button>
          )}
          {status === "open" && (
            <button
              type="button"
              onClick={() => save({ status: "closed" })}
              disabled={busy}
              className="px-3 py-1.5 border border-ink text-xs hover:bg-[color:var(--surface-2)] disabled:opacity-50"
            >
              Close form
            </button>
          )}
          <button
            type="button"
            onClick={() => save()}
            disabled={busy}
            className="px-4 py-1.5 bg-ink text-white text-xs hover:bg-[#262622] disabled:bg-[color:var(--surface-4)]"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {(msg || err) && (
        <p className={`text-sm ${err ? "text-destructive" : "text-grass-text"}`}>
          {err ?? msg}
        </p>
      )}

      {tab === "preview" ? (
        <PreviewPane schema={schema} intro={intro} isAnonymous={isAnonymous} />
      ) : (
        <>
          {/* ── settings ──────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Form settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Form name">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => touch(setTitle)(e.target.value)}
                  className="w-full border px-2 py-1.5 text-sm"
                />
              </Field>

              <Field
                label="Intro"
                hint="Shown once, on the first screen. Say why you're asking and how long it takes."
              >
                <textarea
                  rows={3}
                  value={intro}
                  onChange={(e) => touch(setIntro)(e.target.value)}
                  className="w-full border px-2 py-1.5 text-sm"
                  placeholder="Thanks for serving at this event. Your honest read helps us run the next one better."
                />
              </Field>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isAnonymous}
                  onChange={(e) => touch(setIsAnonymous)(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  Collect responses anonymously
                  <span className="block text-xs text-muted-foreground">
                    {isAnonymous
                      ? "The form never asks who is answering, and no name is stored. People tend to say the harder, more useful thing."
                      : "The form asks for a name (required) and email (optional) before the questions."}
                  </span>
                </span>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Close automatically on"
                  hint="Optional. After this date the link shows a closed notice."
                >
                  <input
                    type="date"
                    value={closesAt}
                    onChange={(e) => touch(setClosesAt)(e.target.value)}
                    className="w-full border px-2 py-1.5 text-sm"
                  />
                </Field>
                <Field label="Thank-you heading">
                  <input
                    type="text"
                    value={tyHeading}
                    onChange={(e) => touch(setTyHeading)(e.target.value)}
                    placeholder="Thank you"
                    className="w-full border px-2 py-1.5 text-sm"
                  />
                </Field>
              </div>

              <Field label="Thank-you message">
                <textarea
                  rows={2}
                  value={tyMessage}
                  onChange={(e) => touch(setTyMessage)(e.target.value)}
                  placeholder="Your feedback is in. It goes straight to the people planning the next one."
                  className="w-full border px-2 py-1.5 text-sm"
                />
              </Field>
            </CardContent>
          </Card>

          {/* ── questions ─────────────────────────────────── */}
          {schema.sections.map((section, sIdx) => (
            <SectionEditor
              key={section.id}
              section={section}
              index={sIdx}
              total={schema.sections.length}
              onChange={(patch) => updateSection(section.id, patch)}
              onMove={(dir) => moveSection(sIdx, dir)}
              onRemove={() => removeSection(section.id)}
              onAddField={(type) => addField(section.id, type)}
              onFieldChange={(fieldId, patch) =>
                updateField(section.id, fieldId, patch)
              }
              onFieldType={(fieldId, type) => changeType(section.id, fieldId, type)}
              onFieldMove={(idx, dir) => moveField(section.id, idx, dir)}
              onFieldRemove={(fieldId) => removeField(section.id, fieldId)}
              onFieldDuplicate={(fieldId) => duplicateField(section.id, fieldId)}
            />
          ))}

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={addSection}
              className="px-3 py-1.5 border text-xs hover:bg-[color:var(--surface-2)]"
            >
              + Add section
            </button>
            <button
              type="button"
              onClick={destroy}
              disabled={busy}
              className="text-xs text-destructive hover:underline"
            >
              Delete this feedback form
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mono-label block mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function SectionEditor({
  section,
  index,
  total,
  onChange,
  onMove,
  onRemove,
  onAddField,
  onFieldChange,
  onFieldType,
  onFieldMove,
  onFieldRemove,
  onFieldDuplicate,
}: {
  section: FeedbackSection;
  index: number;
  total: number;
  onChange: (patch: Partial<FeedbackSection>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onAddField: (type: FeedbackFieldType) => void;
  onFieldChange: (fieldId: string, patch: Partial<FeedbackField>) => void;
  onFieldType: (fieldId: string, type: FeedbackFieldType) => void;
  onFieldMove: (idx: number, dir: -1 | 1) => void;
  onFieldRemove: (fieldId: string) => void;
  onFieldDuplicate: (fieldId: string) => void;
}) {
  const [addType, setAddType] = useState<FeedbackFieldType>("rating");

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex-1 space-y-2">
          <input
            type="text"
            value={section.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Section title"
            className="w-full border px-2 py-1.5 text-sm font-medium"
          />
          <input
            type="text"
            value={section.description ?? ""}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Section description (optional)"
            className="w-full border px-2 py-1.5 text-xs"
          />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <IconBtn label="Move section up" disabled={index === 0} onClick={() => onMove(-1)}>
            ↑
          </IconBtn>
          <IconBtn
            label="Move section down"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          >
            ↓
          </IconBtn>
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-destructive hover:underline px-1"
          >
            Remove
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {section.fields.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No questions in this section yet.
          </p>
        ) : (
          section.fields.map((field, idx) => (
            <QuestionEditor
              key={field.id}
              field={field}
              index={idx}
              total={section.fields.length}
              onChange={(patch) => onFieldChange(field.id, patch)}
              onType={(t) => onFieldType(field.id, t)}
              onMove={(dir) => onFieldMove(idx, dir)}
              onRemove={() => onFieldRemove(field.id)}
              onDuplicate={() => onFieldDuplicate(field.id)}
            />
          ))
        )}

        <div className="flex items-center gap-2 border-t pt-3">
          <select
            value={addType}
            onChange={(e) => setAddType(e.target.value as FeedbackFieldType)}
            className="border px-2 py-1.5 text-xs"
          >
            {FEEDBACK_FIELD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onAddField(addType)}
            className="px-3 py-1.5 border text-xs hover:bg-[color:var(--surface-2)]"
          >
            + Add question
          </button>
          <span className="text-xs text-muted-foreground">
            {FEEDBACK_FIELD_TYPES.find((t) => t.value === addType)?.hint}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function QuestionEditor({
  field,
  index,
  total,
  onChange,
  onType,
  onMove,
  onRemove,
  onDuplicate,
}: {
  field: FeedbackField;
  index: number;
  total: number;
  onChange: (patch: Partial<FeedbackField>) => void;
  onType: (t: FeedbackFieldType) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const options = field.options ?? [];

  function setOption(i: number, v: string) {
    const next = [...options];
    next[i] = v;
    onChange({ options: next });
  }

  return (
    <div className="border p-3 space-y-2">
      <div className="flex items-start gap-2">
        <span className="mono-label pt-2 w-6 shrink-0">{index + 1}.</span>
        <input
          type="text"
          value={field.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Question wording"
          className="flex-1 border px-2 py-1.5 text-sm"
        />
        <select
          value={field.type}
          onChange={(e) => onType(e.target.value as FeedbackFieldType)}
          className="border px-2 py-1.5 text-xs shrink-0"
        >
          {FEEDBACK_FIELD_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-start gap-2">
        <span className="w-6 shrink-0" />
        <input
          type="text"
          value={field.helpText ?? ""}
          onChange={(e) => onChange({ helpText: e.target.value })}
          placeholder="Help text (optional)"
          className="flex-1 border px-2 py-1.5 text-xs"
        />
      </div>

      {isChoiceType(field.type) && (
        <div className="pl-8 space-y-1.5">
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={opt}
                onChange={(e) => setOption(i, e.target.value)}
                className="flex-1 border px-2 py-1 text-xs"
              />
              <button
                type="button"
                onClick={() => onChange({ options: options.filter((_, j) => j !== i) })}
                className="text-xs text-destructive hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ options: [...options, `Option ${options.length + 1}`] })}
            className="text-xs text-ink hover:underline"
          >
            + Add option
          </button>
        </div>
      )}

      {field.type === "scale" && (
        <div className="pl-8 grid gap-2 sm:grid-cols-4">
          <label className="text-xs">
            <span className="mono-label block mb-1">From</span>
            <input
              type="number"
              value={field.scaleMin ?? 1}
              onChange={(e) => onChange({ scaleMin: Number(e.target.value) })}
              className="w-full border px-2 py-1 text-xs"
            />
          </label>
          <label className="text-xs">
            <span className="mono-label block mb-1">To</span>
            <input
              type="number"
              value={field.scaleMax ?? 10}
              onChange={(e) => onChange({ scaleMax: Number(e.target.value) })}
              className="w-full border px-2 py-1 text-xs"
            />
          </label>
          <label className="text-xs">
            <span className="mono-label block mb-1">Low label</span>
            <input
              type="text"
              value={field.minLabel ?? ""}
              onChange={(e) => onChange({ minLabel: e.target.value })}
              className="w-full border px-2 py-1 text-xs"
            />
          </label>
          <label className="text-xs">
            <span className="mono-label block mb-1">High label</span>
            <input
              type="text"
              value={field.maxLabel ?? ""}
              onChange={(e) => onChange({ maxLabel: e.target.value })}
              className="w-full border px-2 py-1 text-xs"
            />
          </label>
        </div>
      )}

      <div className="flex items-center justify-between pl-8">
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(e) => onChange({ required: e.target.checked })}
          />
          Required
        </label>
        <div className="flex items-center gap-1">
          <IconBtn label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
            ↑
          </IconBtn>
          <IconBtn label="Move down" disabled={index === total - 1} onClick={() => onMove(1)}>
            ↓
          </IconBtn>
          <button
            type="button"
            onClick={onDuplicate}
            className="text-xs text-ink hover:underline px-1"
          >
            Duplicate
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-destructive hover:underline px-1"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="border px-1.5 py-0.5 text-xs disabled:opacity-30 hover:bg-[color:var(--surface-2)]"
    >
      {children}
    </button>
  );
}

// The preview renders the real public controls on the real public
// surface — same components, same styling — so "does this read well at
// 11pm on a phone" is answerable without publishing the form first.
function PreviewPane({
  schema,
  intro,
  isAnonymous,
}: {
  schema: FeedbackSchema;
  intro: string;
  isAnonymous: boolean;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});

  return (
    <div>
      <p className="mono-label mb-3">
        Preview · answers here are not saved
        {isAnonymous
          ? " · anonymous form, no name is asked"
          : " · the live form asks for a name first"}
      </p>
      <div className="border border-ink bg-bone p-5 sm:p-8">
        <div className="mx-auto max-w-[560px] border border-rule bg-white p-6 sm:p-8">
          {intro.trim() && (
            <p className="mb-7 text-[15px] leading-relaxed text-[color:var(--text-secondary)]">
              {intro}
            </p>
          )}
          {schema.sections.map((section) => (
            <div key={section.id} className="mb-9 last:mb-0">
              <div className="section-bar mb-5">
                <span className="section-bar-title">{section.title}</span>
              </div>
              {section.description && (
                <p className="mb-6 text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
                  {section.description}
                </p>
              )}
              <div className="space-y-7">
                {section.fields.length === 0 ? (
                  <p className="text-sm italic text-muted-foreground">
                    No questions in this section.
                  </p>
                ) : (
                  section.fields.map((field) => (
                    <QuestionInput
                      key={field.id}
                      field={field}
                      value={values[field.id]}
                      onChange={(v) =>
                        setValues((p) => ({ ...p, [field.id]: v }))
                      }
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
