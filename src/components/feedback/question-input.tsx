"use client";

// One feedback question, rendered for the public page.
//
// Shared by the live form (/fb/<slug>) and the builder's preview pane, so
// what an admin previews is literally the control the team will see. It
// leans on the `.ffsa-public` input styling from public-form-shell, and
// only hand-rolls the controls that have no native equivalent: stars and
// the numeric scale.

import {
  fieldRange,
  type FeedbackField,
} from "@/lib/feedback/schema";
import { tokensForBrand } from "@/components/public-form-shell";

type Tokens = ReturnType<typeof tokensForBrand>;

export function QuestionInput({
  field,
  value,
  error,
  onChange,
  tokens: T,
  disabled,
}: {
  field: FeedbackField;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
  tokens: Tokens;
  disabled?: boolean;
}) {
  const str = typeof value === "string" ? value : "";
  const label = (
    <label
      className={`ffsa-public-label ${
        field.required ? "ffsa-public-label-required" : ""
      }`}
    >
      {field.label || "Untitled question"}
    </label>
  );
  const help = field.helpText ? (
    <p
      style={{
        fontSize: 12.5,
        color: T.textDim,
        margin: "-2px 0 8px",
        lineHeight: 1.5,
      }}
    >
      {field.helpText}
    </p>
  ) : null;
  const err = error ? <p className="ffsa-public-error">{error}</p> : null;

  // ── stars ───────────────────────────────────────────────────
  if (field.type === "rating") {
    const current = Number(value) || 0;
    return (
      <div>
        {label}
        {help}
        <div className="flex items-center gap-1.5" role="radiogroup">
          {[1, 2, 3, 4, 5].map((n) => {
            const on = n <= current;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={current === n}
                aria-label={`${n} out of 5`}
                disabled={disabled}
                // Tapping the current value again clears it, which is the
                // only way to undo an accidental star on a touch screen.
                onClick={() => onChange(current === n ? "" : n)}
                style={{
                  fontSize: 30,
                  lineHeight: 1,
                  padding: "2px 3px",
                  background: "none",
                  border: "none",
                  cursor: disabled ? "default" : "pointer",
                  color: on ? T.yellow : T.borderSoft,
                  transition: "color .12s ease, transform .06s ease",
                }}
              >
                ★
              </button>
            );
          })}
          {current > 0 && (
            <span style={{ fontSize: 12.5, color: T.textDim, marginLeft: 8 }}>
              {current} / 5
            </span>
          )}
        </div>
        {err}
      </div>
    );
  }

  // ── numeric scale / NPS ─────────────────────────────────────
  if (field.type === "scale" || field.type === "nps") {
    const { min, max } = fieldRange(field);
    const current = value === "" || value === null || value === undefined ? null : Number(value);
    const steps: number[] = [];
    for (let n = min; n <= max; n++) steps.push(n);
    const minLabel = field.type === "nps" ? "Not at all" : field.minLabel;
    const maxLabel = field.type === "nps" ? "Absolutely" : field.maxLabel;

    return (
      <div>
        {label}
        {help}
        <div className="flex flex-wrap gap-1.5" role="radiogroup">
          {steps.map((n) => {
            const on = current === n;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={disabled}
                onClick={() => onChange(on ? "" : n)}
                style={{
                  minWidth: 40,
                  padding: "9px 0",
                  flex: "1 1 40px",
                  fontSize: 14,
                  fontWeight: on ? 700 : 400,
                  cursor: disabled ? "default" : "pointer",
                  border: `2px solid ${on ? T.yellow : T.border}`,
                  background: on ? T.yellow : T.cardElev,
                  color: on ? T.card : T.text,
                  transition: "background .12s ease, border-color .12s ease",
                }}
              >
                {n}
              </button>
            );
          })}
        </div>
        {(minLabel || maxLabel) && (
          <div
            className="flex justify-between"
            style={{ fontSize: 11.5, color: T.textDim, marginTop: 6 }}
          >
            <span>{minLabel}</span>
            <span>{maxLabel}</span>
          </div>
        )}
        {err}
      </div>
    );
  }

  // ── pick one — radio cards ──────────────────────────────────
  if (field.type === "choice" || field.type === "yes_no") {
    const options = field.type === "yes_no" ? ["Yes", "No"] : (field.options ?? []);
    return (
      <div>
        {label}
        {help}
        <div className="space-y-2">
          {options.map((opt) => {
            const selected = str === opt;
            return (
              <label
                key={opt}
                className={`ffsa-public-card flex items-center gap-3 ${
                  selected ? "is-selected" : ""
                }`}
                style={{ padding: "11px 14px", cursor: disabled ? "default" : "pointer" }}
              >
                <input
                  type="radio"
                  name={field.id}
                  checked={selected}
                  disabled={disabled}
                  onChange={() => onChange(opt)}
                  style={{ width: 16, height: 16, accentColor: T.yellow, flexShrink: 0 }}
                />
                <span style={{ fontSize: 14, color: T.text, lineHeight: 1.45 }}>{opt}</span>
              </label>
            );
          })}
        </div>
        {err}
      </div>
    );
  }

  // ── pick any — checkbox cards ───────────────────────────────
  if (field.type === "multi_choice") {
    const picked = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div>
        {label}
        {help}
        <div className="space-y-2">
          {(field.options ?? []).map((opt) => {
            const selected = picked.includes(opt);
            return (
              <label
                key={opt}
                className={`ffsa-public-card flex items-center gap-3 ${
                  selected ? "is-selected" : ""
                }`}
                style={{ padding: "11px 14px", cursor: disabled ? "default" : "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? [...picked, opt]
                        : picked.filter((p) => p !== opt)
                    )
                  }
                  style={{ width: 16, height: 16, accentColor: T.yellow, flexShrink: 0 }}
                />
                <span style={{ fontSize: 14, color: T.text, lineHeight: 1.45 }}>{opt}</span>
              </label>
            );
          })}
        </div>
        {err}
      </div>
    );
  }

  // ── dropdown ────────────────────────────────────────────────
  if (field.type === "dropdown") {
    return (
      <div>
        {label}
        {help}
        <select
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

  // ── long text ───────────────────────────────────────────────
  if (field.type === "long_text") {
    return (
      <div>
        {label}
        {help}
        <textarea
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

  // ── short text / number / date ──────────────────────────────
  return (
    <div>
      {label}
      {help}
      <input
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
