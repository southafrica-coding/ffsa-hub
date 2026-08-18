"use client";

// One feedback question, in the Hub's editorial language.
//
// Shared by the live form (/fb/<slug>) and the builder's preview pane, so
// what an admin previews is literally the control the team will see.
//
// Text fields, selects and textareas are deliberately left unstyled here:
// globals.css already gives every input the Hub's square, rule-bordered
// treatment, and inheriting it is what keeps this page looking like the
// rest of the Hub. Only the controls the Hub has no equivalent for —
// scored rows and selectable option rows — are built by hand, from the
// same tokens: ink fill for chosen, rule border for not, and the single
// yellow tick as the accent.

import { fieldRange, type FeedbackField } from "@/lib/feedback/schema";

export function QuestionInput({
  field,
  value,
  error,
  onChange,
  disabled,
}: {
  field: FeedbackField;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  const str = typeof value === "string" ? value : "";

  const header = (
    <>
      <label className="mono-label block">
        {field.label || "Untitled question"}
        {field.required && <span className="ml-1 text-[color:var(--yellow-ink,#8A6400)]">*</span>}
      </label>
      {field.helpText && (
        <p className="mt-1 text-[12.5px] leading-relaxed text-[color:var(--text-tertiary)]">
          {field.helpText}
        </p>
      )}
    </>
  );
  const err = error ? (
    <p className="mono-label mt-2 text-destructive">{error}</p>
  ) : null;

  // ── scored rows: rating 1–5, scale, NPS 0–10 ───────────────
  if (field.type === "rating" || field.type === "scale" || field.type === "nps") {
    const { min, max } = fieldRange(field);
    const current =
      value === "" || value === null || value === undefined ? null : Number(value);
    const steps: number[] = [];
    for (let n = min; n <= max; n++) steps.push(n);
    const minLabel =
      field.type === "nps" ? "Not at all" : field.type === "rating" ? "Poor" : field.minLabel;
    const maxLabel =
      field.type === "nps" ? "Absolutely" : field.type === "rating" ? "Excellent" : field.maxLabel;

    return (
      <div>
        {header}
        {/* Grid, not flex-wrap: an 11-point scale wraps on a phone, and
            flex-1 would stretch the leftovers on the last row into fat
            odd cells. auto-fit keeps every cell the same width however
            many rows it takes. */}
        <div
          className="mt-3 grid border-l border-t border-rule bg-white"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(44px, 1fr))" }}
          role="radiogroup"
        >
          {steps.map((n) => {
            const on = current === n;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={disabled}
                // Tapping the chosen value again clears it — the only way
                // to undo a mis-tap on a phone.
                onClick={() => onChange(on ? "" : n)}
                className={`numeral border-b border-r border-rule py-3 text-center text-[19px] transition-colors ${
                  on
                    ? "bg-ink text-white"
                    : "bg-white text-[color:var(--text-tertiary)] hover:bg-bone"
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>
        {(minLabel || maxLabel) && (
          <div className="mt-2 flex justify-between">
            <span className="mono-label">{minLabel}</span>
            <span className="mono-label">{maxLabel}</span>
          </div>
        )}
        {err}
      </div>
    );
  }

  // ── pick one ───────────────────────────────────────────────
  if (field.type === "choice" || field.type === "yes_no") {
    const options = field.type === "yes_no" ? ["Yes", "No"] : (field.options ?? []);
    return (
      <div>
        {header}
        <div className="mt-3 space-y-2">
          {options.map((opt) => (
            <OptionRow
              key={opt}
              kind="radio"
              name={field.id}
              label={opt}
              selected={str === opt}
              disabled={disabled}
              onSelect={() => onChange(opt)}
            />
          ))}
        </div>
        {err}
      </div>
    );
  }

  // ── pick any ───────────────────────────────────────────────
  if (field.type === "multi_choice") {
    const picked = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div>
        {header}
        <div className="mt-3 space-y-2">
          {(field.options ?? []).map((opt) => (
            <OptionRow
              key={opt}
              kind="checkbox"
              name={field.id}
              label={opt}
              selected={picked.includes(opt)}
              disabled={disabled}
              onSelect={() =>
                onChange(
                  picked.includes(opt)
                    ? picked.filter((p) => p !== opt)
                    : [...picked, opt]
                )
              }
            />
          ))}
        </div>
        {err}
      </div>
    );
  }

  // ── dropdown ───────────────────────────────────────────────
  if (field.type === "dropdown") {
    return (
      <div>
        {header}
        <select
          className="mt-3 w-full"
          value={str}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— choose —</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        {err}
      </div>
    );
  }

  // ── long text ──────────────────────────────────────────────
  if (field.type === "long_text") {
    return (
      <div>
        {header}
        <textarea
          className="mt-3 w-full"
          rows={4}
          value={str}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type your answer…"
        />
        {err}
      </div>
    );
  }

  // ── short text / number / date ─────────────────────────────
  return (
    <div>
      {header}
      <input
        className="mt-3 w-full"
        type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
        value={str}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.type === "short_text" ? "Type your answer…" : undefined}
      />
      {err}
    </div>
  );
}

/**
 * A selectable row. Chosen state is carried by an ink border and a solid
 * yellow bar down the left edge — the design system's one accent, used
 * once per row rather than as a fill, so a long list doesn't turn into a
 * wall of yellow.
 */
function OptionRow({
  kind,
  name,
  label,
  selected,
  disabled,
  onSelect,
}: {
  kind: "radio" | "checkbox";
  name: string;
  label: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 border px-4 py-3 transition-colors ${
        selected ? "border-ink bg-bone" : "border-rule bg-white hover:bg-bone"
      }`}
    >
      <span
        aria-hidden
        className={`-my-3 -ml-4 mr-1 h-[46px] w-[3px] shrink-0 ${
          selected ? "bg-yellow" : "bg-transparent"
        }`}
      />
      <input
        type={kind}
        name={name}
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
        className="h-4 w-4 shrink-0 accent-[#0A0A0A]"
      />
      {/* globals.css uppercases and mono-tracks every bare `label`, and
          those properties inherit into the text inside one. An option is
          someone's own wording — "Registration desk", not "REGISTRATION
          DESK" — so the row text opts back out explicitly. */}
      <span className="font-[family-name:var(--font-roboto)] text-[14.5px] font-normal normal-case leading-snug tracking-normal text-[color:var(--text-primary)]">
        {label}
      </span>
    </label>
  );
}
