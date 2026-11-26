"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormAccessMode,
  type FormField,
  type FormFieldType,
  type FormSchema,
  type FormStep,
  CONTACT_FIELD_KEYS,
  isBooleanParentType,
  isParentEligible,
  newLocalId,
  numericBounds,
  parentValueChoices,
  validateFormSchema,
} from "@/lib/forms/schema";
import { StatusPill } from "@/components/ffsa";
import {
  ACCESS_MODE_LABELS,
  CHOICE_TYPES,
  FIELD_TYPE_LABELS,
  describeField,
  routeChip,
} from "./describe";
import { RoutesEditor } from "./route-editor";
import { SharePanel } from "./share-panel";
import { isMissioPublicFeedbackForm } from "@/lib/missio/public-feedback-link";

// ============================================================
// Form builder — shared by /forms and /events/[id]/forms
// ============================================================
// One component, two homes. An event form passes eventId and gets
// the event settings (base label, attendance, outcomes); a Hub form
// gets who-can-fill (access mode). The schema, the questions and the
// Route to editor are the same in both.
//
// Phone first: the list is one column of tappable questions; tapping
// one opens it full-width with its Route to settings below.
// ============================================================

type Outcome = { id: string; name: string };
type Label = { id: string; slug: string; name: string; color: string | null };

export type FormBuilderMeta = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  records_attendance: boolean;
  label_id: string | null;
  /** Hub forms only. Null/undefined (before migration 390) reads as public. */
  access_mode?: FormAccessMode | null;
  /** forms.kind. The Missio weekly feedback form opens from one public link. */
  kind?: string | null;
};

/** The Missio weekly feedback form's share story: one public link with a house church picker. */
export const MISSIO_PUBLIC_ACCESS_LABEL = "Anyone with the link · picks a house church";
export const MISSIO_PUBLIC_SHARE_NOTE =
  "Anyone with this link can fill it in, no login. The first question asks which house church they are in; the answers land on that house.";

const INPUT =
  "min-h-11 w-full border border-[color:var(--rule-strong)] bg-[color:var(--surface-1,#fff)] px-3 py-2 text-[15px] font-normal normal-case tracking-normal";
const BTN =
  "inline-flex min-h-11 shrink-0 items-center justify-center border border-ink px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink hover:bg-bone disabled:opacity-50";
const BTN_PRIMARY =
  "inline-flex min-h-11 shrink-0 items-center justify-center border border-ink bg-ink px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white hover:bg-[var(--ink-bg-hover)] disabled:opacity-50";
const BTN_QUIET =
  "inline-flex min-h-11 items-center px-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--text-secondary)] hover:text-ink disabled:opacity-30";

type FieldRef = { field: FormField; stepId: string; fieldIdx: number; position: number };

function flattenFields(schema: FormSchema): FieldRef[] {
  const out: FieldRef[] = [];
  let position = 0;
  for (const step of schema.steps) {
    step.fields.forEach((field, fieldIdx) => {
      out.push({ field, stepId: step.id, fieldIdx, position: position++ });
    });
  }
  return out;
}

/** True when the form collects an email or phone, which the submit rule needs. */
function hasContactField(schema: FormSchema): boolean {
  return schema.steps.some((s) => s.fields.some((f) => f.key === "email" || f.key === "phone"));
}

export function FormBuilder({
  eventId,
  form,
  initialSchema,
  outcomes = [],
  labels = [],
  responsesHref,
  backHref,
  backLabel,
  questionsOnly = false,
  contextLabel,
}: {
  /** Set for an event form; absent for a Hub form under /forms. */
  eventId?: string;
  form: FormBuilderMeta;
  initialSchema: FormSchema;
  outcomes?: Outcome[];
  labels?: Label[];
  responsesHref: string;
  backHref?: string;
  backLabel?: string;
  /**
   * The Missio pastor editor for the weekly feedback form: questions and
   * name only. No publish / unpublish, no "who can fill it in", no /f line
   * here (the Missio page shows the public link itself), and a save sends just name and
   * schema, which is all /api/forms/[id] lets a pastor change.
   */
  questionsOnly?: boolean;
  /** The small line above the name. Defaults to "Event form" / "Hub form". */
  contextLabel?: string;
}) {
  const isEvent = Boolean(eventId);
  // Opens publicly at /f/<slug> with a house picker, whatever access_mode says.
  const missioPublic = isMissioPublicFeedbackForm({ kind: form.kind, slug: form.slug, event_id: eventId ?? null });
  const router = useRouter();
  const [name, setName] = useState(form.name);
  const [schema, setSchema] = useState<FormSchema>(initialSchema);
  const [labelId, setLabelId] = useState(form.label_id ?? "");
  const [recordsAttendance, setRecordsAttendance] = useState(form.records_attendance);
  const [accessMode, setAccessMode] = useState<FormAccessMode>(form.access_mode ?? "public");
  const [isActive, setIsActive] = useState(form.is_active);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Opening a question (or going back) starts at the top, like a new page.
  // The admin shell scrolls <main>, not the window.
  useEffect(() => {
    document.querySelector("[data-shell-main]")?.scrollTo?.({ top: 0 });
    window.scrollTo?.({ top: 0 });
  }, [selectedId]);

  const flat = useMemo(() => flattenFields(schema), [schema]);
  const problems = useMemo(() => validateFormSchema(schema), [schema]);
  const problemCount = Object.keys(problems).length;

  // ── schema mutation helpers ───────────────────────────────
  function update(next: Partial<FormSchema>) {
    setSchema((s) => ({ ...s, ...next }));
  }
  function updateStep(stepId: string, patch: Partial<FormStep>) {
    setSchema((s) => ({
      ...s,
      steps: s.steps.map((st) => (st.id === stepId ? { ...st, ...patch } : st)),
    }));
  }
  function updateField(fieldId: string, patch: Partial<FormField>) {
    setSchema((s) => ({
      ...s,
      steps: s.steps.map((st) => ({
        ...st,
        fields: st.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)),
      })),
    }));
  }
  function addStep() {
    update({
      steps: [
        ...schema.steps,
        { id: newLocalId("step"), title: `Section ${schema.steps.length + 1}`, fields: [] },
      ],
    });
  }
  function removeStep(stepId: string) {
    update({ steps: schema.steps.filter((s) => s.id !== stepId) });
  }
  function moveStep(idx: number, dir: -1 | 1) {
    const next = [...schema.steps];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    update({ steps: next });
  }
  function addField(stepId: string) {
    const f: FormField = {
      id: newLocalId("field"),
      type: "text",
      label: "New question",
      key: "",
      required: false,
    };
    update({
      steps: schema.steps.map((s) => (s.id === stepId ? { ...s, fields: [...s.fields, f] } : s)),
    });
    setSelectedId(f.id);
  }
  function removeField(fieldId: string) {
    // Children of a removed parent become unconditional rather than
    // permanently hidden.
    update({
      steps: schema.steps.map((s) => ({
        ...s,
        fields: s.fields
          .filter((f) => f.id !== fieldId)
          .map((f) =>
            f.parentFieldId === fieldId ? { ...f, parentFieldId: null, showWhenValue: null } : f
          ),
      })),
    });
    setSelectedId(null);
  }
  function moveField(fieldId: string, dir: -1 | 1) {
    const step = schema.steps.find((s) => s.fields.some((f) => f.id === fieldId));
    if (!step) return;
    const idx = step.fields.findIndex((f) => f.id === fieldId);
    const next = [...step.fields];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    updateStep(step.id, { fields: next });
  }

  // ── save ──────────────────────────────────────────────────
  async function save(publish?: boolean) {
    setErr(null);
    setMsg(null);
    if (problemCount > 0) {
      setErr(
        `${problemCount} question${problemCount === 1 ? " needs" : "s need"} fixing before this can be saved.`
      );
      return;
    }
    setBusy(true);
    const nextActive = publish === undefined ? isActive : publish;
    const body: Record<string, unknown> = questionsOnly
      ? { name: name.trim(), schema }
      : {
          name: name.trim(),
          schema,
          is_active: nextActive,
        };
    if (questionsOnly) {
      // name and schema only; see the prop.
    } else if (isEvent) {
      body.label_id = labelId || null;
      body.records_attendance = recordsAttendance;
    } else if (accessMode !== (form.access_mode ?? "public")) {
      // Sent only when changed, so a form already on personal links (set
      // up elsewhere) still saves its questions.
      body.access_mode = accessMode;
    }
    const res = await fetch(`/api/forms/${form.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      setErr(data.message ?? data.error ?? "Failed to save");
      return;
    }
    setIsActive(nextActive);
    setMsg(publish === true ? "Published" : publish === false ? "Unpublished" : "Saved");
    router.refresh();
  }

  const publicUrl = origin ? `${origin}/f/${form.slug}` : `/f/${form.slug}`;
  const scannableUrl = origin ? `${origin}/f/${form.slug}` : "";

  const notices = (
    <>
      {err && (
        <p role="alert" className="text-sm text-destructive">
          {err}
        </p>
      )}
      {msg && <p className="text-sm text-grass-text">{msg}</p>}
    </>
  );

  // ── one question, full width ──────────────────────────────
  const selected = selectedId ? flat.find((r) => r.field.id === selectedId) : undefined;
  if (selected) {
    const eligibleParents = flat
      .filter((r) => r.position < selected.position && isParentEligible(r.field))
      .map((r) => r.field);
    const step = schema.steps.find((s) => s.id === selected.stepId)!;
    return (
      <div data-testid="question-view">
        <div className="border-b border-ink bg-white px-5 pb-4 pt-4 md:px-8">
          <button type="button" onClick={() => setSelectedId(null)} className={BTN_QUIET}>
            ← {name || "Form"}
          </button>
          <div className="masthead-context mt-2">
            Question {selected.position + 1} of {flat.length} · Route to
          </div>
          <h1 className="masthead-title !text-[clamp(28px,8vw,44px)]">
            {selected.field.label || "Untitled question"}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-[color:var(--text-secondary)]">
            The answer is always kept with the response. Extra routes run only when their rule
            matches.
          </p>
        </div>

        <div className="px-5 py-5 md:px-8">
          <p className="mono-label mb-3">Question</p>
          <QuestionFields
            field={selected.field}
            isEvent={isEvent}
            outcomes={outcomes}
            eligibleParents={eligibleParents}
            onChange={(patch) => updateField(selected.field.id, patch)}
          />
          {problems[selected.field.id] && (
            <p role="alert" className="mt-3 text-[13px] font-bold text-amber">
              {problems[selected.field.id]}
            </p>
          )}
        </div>

        <div className="section-bar">
          <span className="section-bar-title">Always kept</span>
        </div>
        <div className="px-5 py-4 md:px-8">
          <div className="border border-[color:var(--rule-strong)] bg-bone p-3">
            <p className="text-[13px] text-[color:var(--text-secondary)]">Every time it is answered</p>
            <p className="mt-0.5 text-[14px] font-bold">Kept with this response</p>
            <p className="mt-1 text-[12px] text-[color:var(--text-tertiary)]">
              Anyone who can read this form&rsquo;s responses can see it.
            </p>
          </div>
        </div>

        <div className="section-bar">
          <span className="section-bar-title">Then, if…</span>
          <span className="section-bar-meta">
            {(selected.field.routes ?? []).length} route
            {(selected.field.routes ?? []).length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="px-5 py-4 md:px-8">
          <RoutesEditor
            field={selected.field}
            onChange={(routes) => updateField(selected.field.id, { routes })}
          />
        </div>

        <div className="space-y-3 border-t border-[color:var(--rule)] px-5 py-4 md:px-8">
          <div className="flex flex-wrap gap-x-4">
            <button
              type="button"
              onClick={() => moveField(selected.field.id, -1)}
              disabled={selected.fieldIdx === 0}
              className={BTN_QUIET}
            >
              Move up
            </button>
            <button
              type="button"
              onClick={() => moveField(selected.field.id, 1)}
              disabled={selected.fieldIdx === step.fields.length - 1}
              className={BTN_QUIET}
            >
              Move down
            </button>
            <button
              type="button"
              onClick={() => removeField(selected.field.id)}
              className={`${BTN_QUIET} hover:!text-destructive`}
            >
              Remove question
            </button>
          </div>
          {notices}
          <div className="flex gap-2">
            <button type="button" onClick={() => setSelectedId(null)} className={`${BTN} flex-1`}>
              Back to the form
            </button>
            <button
              type="button"
              onClick={() => save()}
              disabled={busy}
              className={`${BTN_PRIMARY} flex-1`}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── the form: header, share, settings, questions ──────────
  return (
    <div data-testid="form-view">
      <div className="border-b border-ink bg-white px-5 pb-4 pt-4 md:px-8 md:pb-5 md:pt-6">
        {backHref && (
          <Link href={backHref} className={BTN_QUIET}>
            ← {backLabel ?? "Back"}
          </Link>
        )}
        <div className="masthead-context mt-1">{contextLabel ?? (isEvent ? "Event form" : "Hub form")}</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Form name"
          className="masthead-title w-full outline-none"
        />
        {!questionsOnly && (
          <p className="mt-1.5 break-all font-mono text-[11px] text-[color:var(--text-tertiary)]">{publicUrl}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusPill tone={isActive ? "good" : "quiet"}>{isActive ? "Published" : "Draft"}</StatusPill>
          {!isEvent && (
            <StatusPill>{missioPublic ? MISSIO_PUBLIC_ACCESS_LABEL : ACCESS_MODE_LABELS[accessMode]}</StatusPill>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={responsesHref} className={BTN}>
            Responses
          </Link>
          <button type="button" onClick={() => save()} disabled={busy} className={BTN}>
            Save
          </button>
          {questionsOnly ? null : isActive ? (
            <button type="button" onClick={() => save(false)} disabled={busy} className={BTN}>
              Unpublish
            </button>
          ) : (
            <button type="button" onClick={() => save(true)} disabled={busy} className={BTN_PRIMARY}>
              Save &amp; publish
            </button>
          )}
        </div>
      </div>

      <div className={questionsOnly && !err && !msg ? "hidden" : "space-y-3 px-5 py-5 md:px-8"}>
        {notices}
        {!questionsOnly && !hasContactField(schema) && (
          <p className="border border-amber-border bg-[color:var(--yellow-dim,#FFF6DD)] px-3 py-2 text-[13px] text-amber">
            People can&rsquo;t send this form yet: it needs an Email or Phone question saved into
            the contact&rsquo;s email or phone.
          </p>
        )}
        {!questionsOnly && (
          <SharePanel
            url={scannableUrl}
            formName={name}
            accessMode={isEvent || missioPublic ? "public" : accessMode}
            note={missioPublic ? MISSIO_PUBLIC_SHARE_NOTE : undefined}
            isActive={isActive}
          />
        )}
      </div>

      {!questionsOnly && (
      <>
      <div className="section-bar">
        <span className="section-bar-title">Settings</span>
      </div>
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 md:px-8">
        {isEvent ? (
          <>
            <label className="block text-sm">
              <span className="mono-label">Base label</span>
              <select
                value={labelId}
                onChange={(e) => setLabelId(e.target.value)}
                className={`${INPUT} mt-1`}
              >
                <option value="">— none —</option>
                {labels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm sm:mt-5">
              <input
                type="checkbox"
                checked={recordsAttendance}
                onChange={(e) => setRecordsAttendance(e.target.checked)}
              />
              Submitting records event attendance
            </label>
            <label className="block text-sm">
              <span className="mono-label">Accent color</span>
              <input
                type="color"
                value={schema.branding.accentColor ?? "#1e40af"}
                onChange={(e) =>
                  update({ branding: { ...schema.branding, accentColor: e.target.value } })
                }
                className="mt-1 block h-11 w-16 border"
              />
            </label>
          </>
        ) : missioPublic ? (
          <div className="block text-sm" data-testid="missio-public-access">
            <span className="mono-label">Who can fill it in</span>
            <p className="mt-1 text-[14px] leading-snug">{MISSIO_PUBLIC_SHARE_NOTE}</p>
          </div>
        ) : (
          <label className="block text-sm">
            <span className="mono-label">Who can fill it in</span>
            <select
              aria-label="Who can fill it in"
              value={accessMode}
              onChange={(e) => setAccessMode(e.target.value as FormAccessMode)}
              className={`${INPUT} mt-1`}
            >
              <option value="public">{ACCESS_MODE_LABELS.public}</option>
              <option value="logged_in">{ACCESS_MODE_LABELS.logged_in}</option>
              {/* Personal links exist only for the Missio weekly feedback form,
                  which now opens from its one public link; no other form can
                  use them, so this can't be chosen. */}
              <option value="token" disabled>
                {ACCESS_MODE_LABELS.token}
              </option>
            </select>
          </label>
        )}
      </div>
      </>
      )}

      {schema.steps.map((step, sIdx) => (
        <section key={step.id} aria-label={step.title || `Section ${sIdx + 1}`}>
          <div className="section-bar">
            <input
              aria-label={`Section ${sIdx + 1} title`}
              value={step.title}
              onChange={(e) => updateStep(step.id, { title: e.target.value })}
              className="section-bar-input min-w-0 flex-1 outline-none"
            />
            <span className="section-bar-meta">
              {step.fields.length} question{step.fields.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="px-5 py-3 md:px-8">
            <ul className="border border-[color:var(--rule-strong)]">
              {step.fields.length === 0 && (
                <li className="px-3.5 py-3 text-[13px] text-[color:var(--text-tertiary)]">
                  No questions in this section yet.
                </li>
              )}
              {step.fields.map((field) => (
                <QuestionRow
                  key={field.id}
                  field={field}
                  problem={problems[field.id]}
                  parentLabel={
                    field.parentFieldId
                      ? flat.find((r) => r.field.id === field.parentFieldId)?.field.label ?? null
                      : null
                  }
                  onOpen={() => setSelectedId(field.id)}
                />
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap gap-x-4">
              <button type="button" onClick={() => addField(step.id)} className={BTN_QUIET}>
                + Add question
              </button>
              {schema.steps.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => moveStep(sIdx, -1)}
                    disabled={sIdx === 0}
                    className={BTN_QUIET}
                  >
                    Section up
                  </button>
                  <button
                    type="button"
                    onClick={() => moveStep(sIdx, 1)}
                    disabled={sIdx === schema.steps.length - 1}
                    className={BTN_QUIET}
                  >
                    Section down
                  </button>
                  <button
                    type="button"
                    onClick={() => removeStep(step.id)}
                    className={`${BTN_QUIET} hover:!text-destructive`}
                  >
                    Remove section
                  </button>
                </>
              )}
            </div>
          </div>
        </section>
      ))}

      <div className="space-y-2 border-t border-[color:var(--rule)] px-5 py-4 md:px-8">
        <button type="button" onClick={addStep} className={`${BTN} w-full`}>
          Add section
        </button>
        <button
          type="button"
          onClick={() => save()}
          disabled={busy}
          className={`${BTN_PRIMARY} w-full`}
        >
          Save form
        </button>
        <p className="text-[12px] text-[color:var(--text-tertiary)]">
          Tap a question to edit it and set where its answer goes.
        </p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// A question in the list
// ────────────────────────────────────────────────────────────

function QuestionRow({
  field,
  problem,
  parentLabel,
  onOpen,
}: {
  field: FormField;
  problem?: string;
  parentLabel: string | null;
  onOpen: () => void;
}) {
  const routes = field.routes ?? [];
  return (
    <li className="border-b border-[color:var(--rule)] last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        className="block min-h-11 w-full px-3.5 py-3 text-left !font-sans !font-normal normal-case tracking-normal hover:bg-bone"
        style={field.parentFieldId ? { paddingLeft: 28 } : undefined}
      >
        {parentLabel && (
          <span className="mono-label block">↳ Only if &ldquo;{parentLabel}&rdquo; is {field.showWhenValue === "true" ? "ticked" : field.showWhenValue}</span>
        )}
        <span className="block text-[15px] font-bold leading-snug">{field.label || "Untitled question"}</span>
        <span className="mt-0.5 block text-[13px] text-[color:var(--text-secondary)]">
          {describeField(field)}
        </span>
        {routes.length > 0 && (
          <span className="mt-2 flex flex-wrap gap-1.5">
            {routes.map((r, i) => (
              <span
                key={i}
                className={`border px-2 py-1 text-[12px] leading-tight ${
                  r.action === "slack"
                    ? "border-amber-border bg-[color:var(--yellow-dim,#FFF6DD)]"
                    : "border-[color:var(--rule-strong)] bg-bone"
                }`}
              >
                {routeChip(r)}
              </span>
            ))}
          </span>
        )}
        {problem && <span className="mt-1.5 block text-[12px] font-bold text-amber">{problem}</span>}
      </button>
    </li>
  );
}

// ────────────────────────────────────────────────────────────
// The question's own settings
// ────────────────────────────────────────────────────────────

function QuestionFields({
  field,
  isEvent,
  outcomes,
  eligibleParents,
  onChange,
}: {
  field: FormField;
  isEvent: boolean;
  outcomes: Outcome[];
  eligibleParents: FormField[];
  onChange: (patch: Partial<FormField>) => void;
}) {
  const isChoice = CHOICE_TYPES.includes(field.type);
  const isOutcome = field.type === "outcome";
  const isConsent = field.type === "consent";
  const isScale = field.type === "linear_scale";
  const isStepper = field.type === "stepper";
  const parent = field.parentFieldId
    ? eligibleParents.find((p) => p.id === field.parentFieldId)
    : undefined;
  const parentValues = parent ? parentValueChoices(parent) : [];
  const orphanedParentRef = field.parentFieldId != null && !parent;
  // Outcomes belong to events; a Hub form can't bind one.
  const types = FIELD_TYPE_LABELS.filter((t) => isEvent || t.value !== "outcome" || isOutcome);

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="block">Question</span>
        <input
          aria-label="Question text"
          value={field.label}
          onChange={(e) => onChange({ label: e.target.value })}
          className={`${INPUT} mt-1.5`}
        />
      </label>

      <label className="block">
        <span className="block">Type</span>
        <select
          aria-label="Question type"
          value={field.type}
          onChange={(e) => {
            const type = e.target.value as FormFieldType;
            const patch: Partial<FormField> = { type };
            if (CHOICE_TYPES.includes(type) && !field.options) patch.options = ["Option 1"];
            if (type === "yes_no") patch.options = ["Yes", "No"];
            if (type === "linear_scale") {
              patch.min = 1;
              patch.max = 5;
            }
            if (type === "stepper") {
              patch.min = 0;
              patch.max = null;
            }
            onChange(patch);
          }}
          className={`${INPUT} mt-1.5`}
        >
          {types.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      {(isScale || isStepper) && (
        <NumericBoundsEditor field={field} onChange={onChange} />
      )}

      {isChoice && (
        <div>
          <span className="block">Options</span>
          <span className="block text-[12px] text-[color:var(--text-tertiary)]">One per line</span>
          <OptionsEditor options={field.options} onChange={(options) => onChange({ options })} />
        </div>
      )}

      {isOutcome && (
        <div className="text-sm">
          {outcomes.length === 0 ? (
            <p className="text-amber">No outcomes on this event yet — add one on the Details tab first.</p>
          ) : (
            <label className="block">
              <span className="block">Responds to outcome</span>
              <select
                value={field.outcomeId ?? ""}
                onChange={(e) => onChange({ outcomeId: e.target.value || null })}
                className={`${INPUT} mt-1.5`}
              >
                <option value="">— pick an outcome —</option>
                {outcomes.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {!isOutcome && !isConsent && (
        <label className="block">
          <span className="block">Save into contact</span>
          <select
            aria-label="Save into contact"
            value={field.key}
            onChange={(e) => onChange({ key: e.target.value })}
            className={`${INPUT} mt-1.5`}
          >
            <option value="">No — keep with the response only</option>
            {CONTACT_FIELD_KEYS.map((k) => (
              <option key={k} value={k}>
                {k.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          checked={field.required}
          onChange={(e) => onChange({ required: e.target.checked })}
        />
        Required
      </label>

      <div className="border-t border-[color:var(--rule)] pt-3">
        <label className="block">
          <span className="block">Show only when</span>
          <select
            aria-label="Show only when"
            value={field.parentFieldId ?? ""}
            onChange={(e) => {
              const nextId = e.target.value || null;
              const nextParent = nextId ? eligibleParents.find((p) => p.id === nextId) : undefined;
              const choices = nextParent ? parentValueChoices(nextParent) : [];
              onChange({ parentFieldId: nextId, showWhenValue: nextId ? choices[0] ?? null : null });
            }}
            className={`${INPUT} mt-1.5`}
          >
            <option value="">Always show</option>
            {eligibleParents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label || "(untitled)"}
              </option>
            ))}
          </select>
        </label>
        {parent && parentValues.length > 0 && (
          <label className="mt-2 block">
            <span className="block">is</span>
            <select
              aria-label="Show when the answer is"
              value={field.showWhenValue ?? ""}
              onChange={(e) => onChange({ showWhenValue: e.target.value || null })}
              className={`${INPUT} mt-1`}
            >
              {isBooleanParentType(parent.type) ? (
                <option value="true">Ticked</option>
              ) : (
                parentValues.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))
              )}
            </select>
          </label>
        )}
        {orphanedParentRef && (
          <p className="mt-1 text-[13px] text-amber">
            The question this depended on is gone — pick another or set it to always show.
          </p>
        )}
        {eligibleParents.length === 0 && (
          <p className="mt-1 text-[12px] text-[color:var(--text-tertiary)]">
            A Yes/No, radio, dropdown or checkbox question above this one can control it.
          </p>
        )}
      </div>
    </div>
  );
}

function numOrNull(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function NumericBoundsEditor({
  field,
  onChange,
}: {
  field: FormField;
  onChange: (patch: Partial<FormField>) => void;
}) {
  const { min, max } = numericBounds(field);
  const isStepper = field.type === "stepper";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5">
        <label className="block min-w-0">
          <span className="block">Lowest</span>
          <input
            aria-label="Lowest value"
            type="number"
            inputMode="numeric"
            value={field.min ?? min}
            onChange={(e) => onChange({ min: numOrNull(e.target.value) })}
            className={`${INPUT} mt-1.5`}
          />
        </label>
        <label className="block min-w-0">
          <span className="block">Highest</span>
          <input
            aria-label="Highest value"
            type="number"
            inputMode="numeric"
            value={field.max ?? (isStepper ? "" : max ?? "")}
            placeholder={isStepper ? "No top" : undefined}
            onChange={(e) => onChange({ max: numOrNull(e.target.value) })}
            className={`${INPUT} mt-1.5`}
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="block min-w-0">
          <span className="block">{isStepper ? "Lowest label" : "Low label"}</span>
          <input
            aria-label="Low label"
            value={field.minLabel ?? ""}
            placeholder={isStepper ? "Optional" : "e.g. Struggling"}
            onChange={(e) => onChange({ minLabel: e.target.value || null })}
            className={`${INPUT} mt-1.5`}
          />
        </label>
        <label className="block min-w-0">
          <span className="block">{isStepper ? "Top label" : "High label"}</span>
          <input
            aria-label="High label"
            value={field.maxLabel ?? ""}
            placeholder={isStepper ? "e.g. More than 5" : "e.g. Doing great"}
            onChange={(e) => onChange({ maxLabel: e.target.value || null })}
            className={`${INPUT} mt-1.5`}
          />
        </label>
      </div>
      {isStepper && (
        <p className="text-[12px] text-[color:var(--text-tertiary)]">
          With a top label, the highest number reads as that label — set Highest to 6 and the label
          to &ldquo;More than 5&rdquo;.
        </p>
      )}
    </div>
  );
}

// Local-state textarea for choice options. It must hold the raw text
// (blank lines included) so Enter moves to a new line; deriving it from
// the cleaned array on every keystroke snapped the cursor back.
function OptionsEditor({
  options,
  onChange,
}: {
  options: string[] | undefined;
  onChange: (next: string[]) => void;
}) {
  const [text, setText] = useState<string>(() => (options ?? []).join("\n"));

  useEffect(() => {
    const fromProps = (options ?? []).join("\n");
    const normalised = text
      .split("\n")
      .map((o) => o.trim())
      .filter(Boolean)
      .join("\n");
    if (fromProps !== normalised) setText(fromProps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  return (
    <textarea
      aria-label="Options"
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        onChange(next.split("\n").map((o) => o.trim()).filter(Boolean));
      }}
      rows={4}
      className="mt-1.5 w-full resize-none border border-[color:var(--rule-strong)] px-3 py-2 text-[15px] font-normal normal-case tracking-normal"
    />
  );
}
