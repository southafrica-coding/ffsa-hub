"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type FormSchema,
  type FormStep,
  type FormField,
  type FormFieldType,
  CONTACT_FIELD_KEYS,
  newLocalId,
  isParentEligible,
  isBooleanParentType,
  parentValueChoices,
} from "@/lib/forms/schema";
import { QrPanel } from "./qr-panel";
import { StatusPill } from "@/components/ffsa";
import Link from "next/link";

type Outcome = { id: string; name: string };
type Label = { id: string; slug: string; name: string; color: string | null };

type FormMeta = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  records_attendance: boolean;
  label_id: string | null;
};

const FIELD_TYPES: { value: FormFieldType; label: string }[] = [
  { value: "text", label: "Short text" },
  { value: "long_text", label: "Long text" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "date", label: "Date" },
  { value: "number", label: "Number" },
  { value: "yes_no", label: "Yes / No" },
  { value: "dropdown", label: "Dropdown" },
  { value: "multiselect", label: "Multi-select" },
  { value: "radio", label: "Radio buttons" },
  { value: "checkbox", label: "Checkbox" },
  { value: "outcome", label: "Outcome response" },
  { value: "consent", label: "Consent (POPIA)" },
];

const CHOICE_TYPES: FormFieldType[] = ["dropdown", "multiselect", "radio"];

// A flattened reference to a field used by the conditional-rule picker:
// each field needs to know which earlier fields are eligible parents.
type FieldRef = {
  field: FormField;
  stepIdx: number;
  fieldIdx: number;
  position: number; // global linearised position across all steps
};

function flattenFields(schema: FormSchema): FieldRef[] {
  const out: FieldRef[] = [];
  let position = 0;
  schema.steps.forEach((step, stepIdx) => {
    step.fields.forEach((field, fieldIdx) => {
      out.push({ field, stepIdx, fieldIdx, position: position++ });
    });
  });
  return out;
}

// Depth = length of the parent chain. Used to indent children in the
// admin list so conditional nesting is visible at a glance. Defensive
// against cycles by capping iterations.
function fieldDepth(
  fieldId: string,
  fieldsById: Map<string, FormField>
): number {
  let depth = 0;
  let current = fieldsById.get(fieldId);
  const seen = new Set<string>();
  while (current?.parentFieldId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = fieldsById.get(current.parentFieldId);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

export function FormBuilder({
  eventId,
  form,
  initialSchema,
  outcomes,
  labels,
  responsesHref,
}: {
  eventId: string;
  form: FormMeta;
  initialSchema: FormSchema;
  outcomes: Outcome[];
  labels: Label[];
  /** Where "View responses" goes. Passed in so the page's one action row
   *  lives here with Save and Publish rather than floating above them. */
  responsesHref: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(form.name);
  const [schema, setSchema] = useState<FormSchema>(initialSchema);
  const [labelId, setLabelId] = useState(form.label_id ?? "");
  const [recordsAttendance, setRecordsAttendance] = useState(form.records_attendance);
  const [isActive, setIsActive] = useState(form.is_active);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // ── schema mutation helpers ───────────────────────────────
  function update(next: Partial<FormSchema>) {
    setSchema((s) => ({ ...s, ...next }));
  }
  function updateStep(stepId: string, patch: Partial<FormStep>) {
    update({
      steps: schema.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
    });
  }
  function updateField(stepId: string, fieldId: string, patch: Partial<FormField>) {
    update({
      steps: schema.steps.map((s) =>
        s.id === stepId
          ? {
              ...s,
              fields: s.fields.map((f) =>
                f.id === fieldId ? { ...f, ...patch } : f
              ),
            }
          : s
      ),
    });
  }
  function addStep() {
    update({
      steps: [
        ...schema.steps,
        { id: newLocalId("step"), title: `Step ${schema.steps.length + 1}`, fields: [] },
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
      label: "New field",
      key: "",
      required: false,
    };
    update({
      steps: schema.steps.map((s) =>
        s.id === stepId ? { ...s, fields: [...s.fields, f] } : s
      ),
    });
  }
  function removeField(stepId: string, fieldId: string) {
    // Removing a parent leaves dangling parentFieldId references on its
    // children. Clear them across the whole schema so those children
    // become unconditional rather than permanently hidden.
    update({
      steps: schema.steps.map((s) => ({
        ...s,
        fields: s.fields
          .filter((f) => !(s.id === stepId && f.id === fieldId))
          .map((f) =>
            f.parentFieldId === fieldId
              ? { ...f, parentFieldId: null, showWhenValue: null }
              : f
          ),
      })),
    });
  }
  function moveField(stepId: string, idx: number, dir: -1 | 1) {
    const step = schema.steps.find((s) => s.id === stepId);
    if (!step) return;
    const next = [...step.fields];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    updateStep(stepId, { fields: next });
  }

  // ── save ──────────────────────────────────────────────────
  async function save(publish?: boolean) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    const nextActive = publish === undefined ? isActive : publish;
    const res = await fetch(`/api/forms/${form.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        schema,
        label_id: labelId || null,
        records_attendance: recordsAttendance,
        is_active: nextActive,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to save");
      return;
    }
    setIsActive(nextActive);
    setMsg(publish === true ? "Published" : publish === false ? "Unpublished" : "Saved");
    router.refresh();
  }

  const publicUrl =
    typeof window !== "undefined" ? `${window.location.origin}/f/${form.slug}` : `/f/${form.slug}`;

  return (
    <>
      {/* The masthead IS the name field. This page's title has always been
          editable in place, so stacking a static Masthead on top of it would
          print the form's name twice — the condensed title below is the
          input. */}
      <div className="flex flex-col gap-4 border-b border-ink bg-white px-5 pb-4 pt-5 md:flex-row md:items-end md:justify-between md:gap-8 md:px-8 md:pb-5 md:pt-6">
        <div className="min-w-0 flex-1">
          <div className="masthead-context">
            Event form
            <span className="font-mono normal-case tracking-normal text-[color:var(--text-tertiary)]">
              {publicUrl}
            </span>
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Form name"
            className="masthead-title w-full outline-none"
          />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2.5 md:pb-1">
          <StatusPill tone={isActive ? "good" : "quiet"}>
            {isActive ? "Published" : "Draft"}
          </StatusPill>
          <Link
            href={responsesHref}
            className="shrink-0 border border-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-ink hover:bg-bone"
          >
            View responses
          </Link>
          <button
            type="button"
            onClick={() => save()}
            disabled={busy}
            className="shrink-0 border border-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-ink hover:bg-bone disabled:opacity-50"
          >
            Save
          </button>
          {isActive ? (
            <button
              type="button"
              onClick={() => save(false)}
              disabled={busy}
              className="shrink-0 border border-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-ink hover:bg-bone disabled:opacity-50"
            >
              Unpublish
            </button>
          ) : (
            <button
              type="button"
              onClick={() => save(true)}
              disabled={busy}
              className="shrink-0 border border-ink bg-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white hover:bg-[#262622] disabled:opacity-50"
            >
              Save &amp; publish
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4 px-5 py-6 md:px-8 md:py-7">
      {err && <p className="text-sm text-destructive">{err}</p>}
      {msg && <p className="text-sm text-grass-text">{msg}</p>}

      {/* Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Settings</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="block text-muted-foreground mb-1">Base label</span>
            <select
              value={labelId}
              onChange={(e) => setLabelId(e.target.value)}
              className="w-full border px-2 py-1.5 text-sm"
            >
              <option value="">— none —</option>
              {labels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm flex items-center gap-2 mt-6">
            <input
              type="checkbox"
              checked={recordsAttendance}
              onChange={(e) => setRecordsAttendance(e.target.checked)}
            />
            Submitting records event attendance
          </label>
          <label className="text-sm">
            <span className="block text-muted-foreground mb-1">Accent color</span>
            <input
              type="color"
              value={schema.branding.accentColor ?? "#1e40af"}
              onChange={(e) =>
                update({ branding: { ...schema.branding, accentColor: e.target.value } })
              }
              className="h-9 w-16 border"
            />
          </label>
        </CardContent>
      </Card>

      {/* QR code */}
      <QrPanel url={publicUrl} formName={name} />

      {/* Steps */}
      {(() => {
        const flat = flattenFields(schema);
        const fieldsById = new Map(flat.map((r) => [r.field.id, r.field]));
        return schema.steps.map((step, sIdx) => (
        <Card key={step.id}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2 flex-1">
              <span className="text-xs text-muted-foreground">Step {sIdx + 1}</span>
              <input
                value={step.title}
                onChange={(e) => updateStep(step.id, { title: e.target.value })}
                className="text-sm font-medium bg-transparent border-b border-transparent hover:border-border focus:border-foreground outline-none flex-1"
              />
            </div>
            <div className="flex gap-1">
              <IconBtn onClick={() => moveStep(sIdx, -1)} disabled={sIdx === 0} label="↑" />
              <IconBtn
                onClick={() => moveStep(sIdx, 1)}
                disabled={sIdx === schema.steps.length - 1}
                label="↓"
              />
              <IconBtn
                onClick={() => removeStep(step.id)}
                disabled={schema.steps.length === 1}
                label="✕"
                danger
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {step.fields.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No fields in this step.</p>
            )}
            {step.fields.map((field, fIdx) => {
              const ref = flat.find((r) => r.field.id === field.id)!;
              const eligibleParents = flat
                .filter(
                  (r) =>
                    r.position < ref.position &&
                    isParentEligible(r.field) &&
                    r.field.id !== field.id
                )
                .map((r) => r.field);
              return (
                <FieldEditor
                  key={field.id}
                  field={field}
                  outcomes={outcomes}
                  eligibleParents={eligibleParents}
                  depth={fieldDepth(field.id, fieldsById)}
                  onChange={(patch) => updateField(step.id, field.id, patch)}
                  onRemove={() => removeField(step.id, field.id)}
                  onMoveUp={() => moveField(step.id, fIdx, -1)}
                  onMoveDown={() => moveField(step.id, fIdx, 1)}
                  canMoveUp={fIdx > 0}
                  canMoveDown={fIdx < step.fields.length - 1}
                />
              );
            })}
            <button
              type="button"
              onClick={() => addField(step.id)}
              className="text-xs text-ink hover:underline"
            >
              + Add field
            </button>
          </CardContent>
        </Card>
        ));
      })()}

      <button
        type="button"
        onClick={addStep}
        className="w-full border-2 border-dashed py-3 text-sm text-muted-foreground hover:bg-accent"
      >
        + Add step
      </button>
      </div>
    </>
  );
}

// Local-state textarea for dropdown / multi-select / radio options. The
// textarea must hold the user's raw text verbatim (including in-progress
// blank lines) so pressing Enter actually moves to a new line — the
// previous implementation derived the textarea value from the cleaned
// `options` array on every keystroke, which immediately stripped any
// empty intermediate line and snapped the cursor back to the line above,
// making it impossible to add a second option.
function OptionsEditor({
  options,
  onChange,
}: {
  options: string[] | undefined;
  onChange: (next: string[]) => void;
}) {
  const [text, setText] = useState<string>(() => (options ?? []).join("\n"));

  // Re-sync from props only when the cleaned text genuinely differs (e.g.
  // the parent seeded ["Option 1"] because field type just switched to a
  // choice type). We never clobber in-progress typing.
  useEffect(() => {
    const fromProps = (options ?? []).join("\n");
    const normalised = text
      .split("\n")
      .map((o) => o.trim())
      .filter(Boolean)
      .join("\n");
    if (fromProps !== normalised) {
      setText(fromProps);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  return (
    <textarea
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        onChange(next.split("\n").map((o) => o.trim()).filter(Boolean));
      }}
      rows={3}
      className="w-full border px-2 py-1 text-xs mt-1 resize-none"
    />
  );
}

function IconBtn({
  onClick,
  disabled,
  label,
  danger,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-6 h-6 text-xs border disabled:opacity-30 ${
        danger ? "text-destructive hover:bg-destructive/10" : "hover:bg-accent"
      }`}
    >
      {label}
    </button>
  );
}

function FieldEditor({
  field,
  outcomes,
  eligibleParents,
  depth,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  field: FormField;
  outcomes: Outcome[];
  eligibleParents: FormField[];
  depth: number;
  onChange: (patch: Partial<FormField>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const isChoice = CHOICE_TYPES.includes(field.type);
  const isOutcome = field.type === "outcome";
  const isConsent = field.type === "consent";

  const parent = field.parentFieldId
    ? eligibleParents.find((p) => p.id === field.parentFieldId)
    : undefined;
  const parentValues = parent ? parentValueChoices(parent) : [];
  // A previously-saved rule may point at a parent the user has since
  // deleted or changed to an ineligible type. Surface that so they can
  // fix it instead of wondering why their child field never appears.
  const orphanedParentRef =
    field.parentFieldId != null && !parent;

  return (
    <div
      className="border p-3 space-y-2 bg-muted/40"
      style={depth > 0 ? { marginLeft: depth * 16 } : undefined}
    >
      {depth > 0 && (
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground -mt-1 mb-1">
          ↳ conditional follow-up
        </p>
      )}
      <div className="flex items-center gap-2">
        <select
          value={field.type}
          onChange={(e) => {
            const type = e.target.value as FormFieldType;
            const patch: Partial<FormField> = { type };
            if (CHOICE_TYPES.includes(type) && !field.options) patch.options = ["Option 1"];
            if (type === "yes_no") patch.options = ["Yes", "No"];
            onChange(patch);
          }}
          className="border px-2 py-1 text-xs"
        >
          {FIELD_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <input
          value={field.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Field label"
          className="flex-1 border px-2 py-1 text-sm"
        />
        <IconBtn onClick={onMoveUp} disabled={!canMoveUp} label="↑" />
        <IconBtn onClick={onMoveDown} disabled={!canMoveDown} label="↓" />
        <IconBtn onClick={onRemove} label="✕" danger />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {!isOutcome && !isConsent && (
          <label className="text-xs flex items-center gap-1">
            Maps to
            <select
              value={field.key}
              onChange={(e) => onChange({ key: e.target.value })}
              className="border px-1.5 py-0.5 text-xs"
            >
              <option value="">Custom (raw data only)</option>
              {CONTACT_FIELD_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-xs flex items-center gap-1">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(e) => onChange({ required: e.target.checked })}
          />
          Required
        </label>
      </div>

      {isOutcome && (
        <div className="text-xs">
          {outcomes.length === 0 ? (
            <p className="text-amber">
              No outcomes on this event yet — add one on the Details tab first.
            </p>
          ) : (
            <label className="flex items-center gap-1">
              Responds to outcome
              <select
                value={field.outcomeId ?? ""}
                onChange={(e) => onChange({ outcomeId: e.target.value || null })}
                className="border px-1.5 py-0.5 text-xs"
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

      {isChoice && (
        <div className="text-xs">
          <span className="text-muted-foreground">Options (one per line)</span>
          <OptionsEditor
            options={field.options}
            onChange={(options) => onChange({ options })}
          />
        </div>
      )}

      {/* Conditional visibility — only show this field when an earlier
          choice field has a particular answer. */}
      <div className="text-xs border-t pt-2 mt-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-muted-foreground">Show only when</span>
          <select
            value={field.parentFieldId ?? ""}
            onChange={(e) => {
              const nextId = e.target.value || null;
              const nextParent = nextId
                ? eligibleParents.find((p) => p.id === nextId)
                : undefined;
              const choices = nextParent ? parentValueChoices(nextParent) : [];
              onChange({
                parentFieldId: nextId,
                // Default the rule to the parent's first value so the
                // condition is meaningful from the moment it's set.
                showWhenValue: nextId ? choices[0] ?? null : null,
              });
            }}
            className="border px-1.5 py-0.5 text-xs max-w-[14rem]"
          >
            <option value="">— always show —</option>
            {eligibleParents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label || "(untitled)"}
              </option>
            ))}
          </select>
          {parent && parentValues.length > 0 && (
            <>
              <span className="text-muted-foreground">is</span>
              <select
                value={field.showWhenValue ?? ""}
                onChange={(e) =>
                  onChange({ showWhenValue: e.target.value || null })
                }
                className="border px-1.5 py-0.5 text-xs"
              >
                {isBooleanParentType(parent.type) ? (
                  <option value="true">Checked</option>
                ) : (
                  parentValues.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))
                )}
              </select>
            </>
          )}
        </div>
        <p className="text-muted-foreground italic mt-1 text-[11px]">
          Eligible parents: Yes/No, radio, dropdown, checkbox, outcome
          response, or consent fields placed above this one.
        </p>
        {orphanedParentRef && (
          <p className="text-amber mt-1">
            The parent question for this rule no longer exists — pick another
            or clear the rule.
          </p>
        )}
        {eligibleParents.length === 0 && (
          <p className="text-muted-foreground italic mt-1">
            No eligible parent exists above this field yet.
          </p>
        )}
      </div>
    </div>
  );
}
