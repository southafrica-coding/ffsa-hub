"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type FormField,
  type FormFieldType,
  newLocalId,
  isParentEligible,
  isBooleanParentType,
  parentValueChoices,
} from "@/lib/forms/schema";
import { CHECKOUT_QUESTION_TYPES } from "@/lib/ticketing/checkout-questions";

// Controlled builder for a flat list of custom questions (FormField[]).
// Shared by the event-level checkout-questions manager (asked once per
// order) and the per-tier ticket-question editor (asked once per ticket)
// so the two never drift on field types, conditional-visibility rules, or
// option editing. Owns no persistence — the parent controls `questions`
// and decides when/how to save.

const TYPE_LABELS: Partial<Record<FormFieldType, string>> = {
  text: "Short text",
  long_text: "Long text",
  email: "Email",
  phone: "Phone",
  date: "Date",
  number: "Number",
  yes_no: "Yes / No",
  dropdown: "Dropdown",
  multiselect: "Multi-select",
  radio: "Radio buttons",
  checkbox: "Checkbox",
};

const FIELD_TYPES = CHECKOUT_QUESTION_TYPES.map((value) => ({
  value,
  label: TYPE_LABELS[value] ?? value,
}));

const CHOICE_TYPES: FormFieldType[] = ["dropdown", "multiselect", "radio"];

function questionDepth(id: string, byId: Map<string, FormField>): number {
  let depth = 0;
  let current = byId.get(id);
  const seen = new Set<string>();
  while (current?.parentFieldId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parentFieldId);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

export function QuestionsBuilder({
  questions,
  onChange,
  addLabel = "+ Add question",
  emptyHint,
}: {
  questions: FormField[];
  onChange: (next: FormField[]) => void;
  addLabel?: string;
  emptyHint?: string;
}) {
  const byId = useMemo(
    () => new Map(questions.map((q) => [q.id, q])),
    [questions]
  );

  function addQuestion() {
    onChange([
      ...questions,
      {
        id: newLocalId("q"),
        type: "text",
        label: "New question",
        key: "",
        required: false,
      },
    ]);
  }

  function updateQuestion(id: string, patch: Partial<FormField>) {
    onChange(questions.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }

  function removeQuestion(id: string) {
    // Clear any conditional rule that referenced the removed question so
    // its children become unconditional rather than permanently hidden.
    onChange(
      questions
        .filter((q) => q.id !== id)
        .map((q) =>
          q.parentFieldId === id
            ? { ...q, parentFieldId: null, showWhenValue: null }
            : q
        )
    );
  }

  function moveQuestion(idx: number, dir: -1 | 1) {
    const next = [...questions];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {questions.length === 0 && emptyHint && (
        <p className="text-xs italic text-muted-foreground">{emptyHint}</p>
      )}

      {questions.map((q, idx) => {
        const eligibleParents = questions.filter(
          (p, i) => i < idx && isParentEligible(p) && p.id !== q.id
        );
        return (
          <QuestionEditor
            key={q.id}
            field={q}
            eligibleParents={eligibleParents}
            depth={questionDepth(q.id, byId)}
            onChange={(patch) => updateQuestion(q.id, patch)}
            onRemove={() => removeQuestion(q.id)}
            onMoveUp={() => moveQuestion(idx, -1)}
            onMoveDown={() => moveQuestion(idx, 1)}
            canMoveUp={idx > 0}
            canMoveDown={idx < questions.length - 1}
          />
        );
      })}

      <button
        type="button"
        onClick={addQuestion}
        className="text-xs text-ink hover:underline"
      >
        {addLabel}
      </button>
    </div>
  );
}

// Local-state textarea for choice options — Enter adds a line without the
// cleaned array snapping the cursor back.
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

function QuestionEditor({
  field,
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
  const parent = field.parentFieldId
    ? eligibleParents.find((p) => p.id === field.parentFieldId)
    : undefined;
  const parentValues = parent ? parentValueChoices(parent) : [];
  const orphanedParentRef = field.parentFieldId != null && !parent;

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
            if (CHOICE_TYPES.includes(type) && !field.options)
              patch.options = ["Option 1"];
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
          placeholder="Question label"
          className="flex-1 border px-2 py-1 text-sm"
        />
        <IconBtn onClick={onMoveUp} disabled={!canMoveUp} label="↑" />
        <IconBtn onClick={onMoveDown} disabled={!canMoveDown} label="↓" />
        <IconBtn onClick={onRemove} label="✕" danger />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-xs flex items-center gap-1">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(e) => onChange({ required: e.target.checked })}
          />
          Required
        </label>
      </div>

      {isChoice && (
        <div className="text-xs">
          <span className="text-muted-foreground">Options (one per line)</span>
          <OptionsEditor
            options={field.options}
            onChange={(options) => onChange({ options })}
          />
        </div>
      )}

      {/* Conditional visibility — show this question only when an earlier
          choice question has a particular answer. */}
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
                onChange={(e) => onChange({ showWhenValue: e.target.value || null })}
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
        {orphanedParentRef && (
          <p className="text-amber mt-1">
            The parent question for this rule no longer exists — pick another or
            clear the rule.
          </p>
        )}
      </div>
    </div>
  );
}
