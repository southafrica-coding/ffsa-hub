"use client";

import { numericBounds, type FormField } from "@/lib/forms/schema";
import type { tokensForBrand } from "@/components/public-form-shell";

// linear_scale and stepper on the public runtime. Both store a whole
// number under the field's key, which is what validateSubmission (F1)
// checks on the server.

type Tokens = ReturnType<typeof tokensForBrand>;

/** The numbers a scale offers, low to high. */
export function scalePoints(field: Pick<FormField, "type" | "min" | "max">): number[] {
  const { min, max } = numericBounds(field);
  const top = max ?? min + 4;
  const out: number[] = [];
  for (let n = min; n <= top && out.length < 11; n++) out.push(n);
  return out;
}

export function LinearScaleInput({
  field,
  value,
  onChange,
  tokens: T,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: number) => void;
  tokens: Tokens;
}) {
  const points = scalePoints(field);
  const current = typeof value === "number" ? value : Number.NaN;
  return (
    <div>
      <div
        role="radiogroup"
        aria-label={field.label}
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))`,
          gap: 6,
        }}
      >
        {points.map((n) => {
          const on = current === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(n)}
              className={`ffsa-public-card ${on ? "is-selected" : ""}`}
              style={{
                minHeight: 48,
                padding: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 17,
                fontWeight: 700,
                color: T.text,
                fontVariantNumeric: "tabular-nums",
                cursor: "pointer",
              }}
            >
              {n}
            </button>
          );
        })}
      </div>
      {(field.minLabel || field.maxLabel) && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            marginTop: 6,
            fontSize: 12,
            color: T.textDim,
          }}
        >
          <span>{field.minLabel ?? ""}</span>
          <span style={{ textAlign: "right" }}>{field.maxLabel ?? ""}</span>
        </div>
      )}
    </div>
  );
}

export function StepperInput({
  field,
  value,
  onChange,
  tokens: T,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: number) => void;
  tokens: Tokens;
}) {
  const { min, max } = numericBounds(field);
  const n = typeof value === "number" && Number.isFinite(value) ? value : min;
  const atTop = max != null && n >= max;
  const btn: React.CSSProperties = {
    width: 48,
    height: 48,
    flexShrink: 0,
    fontSize: 24,
    lineHeight: 1,
    color: T.text,
    background: "transparent",
    border: 0,
    cursor: "pointer",
  };
  return (
    <div>
      <div
        style={{
          display: "inline-flex",
          alignItems: "stretch",
          border: `1px solid ${T.border}`,
        }}
      >
        <button
          type="button"
          aria-label={`Less: ${field.label}`}
          onClick={() => onChange(Math.max(min, n - 1))}
          disabled={n <= min}
          style={{ ...btn, opacity: n <= min ? 0.35 : 1 }}
        >
          −
        </button>
        <output
          aria-live="polite"
          aria-label={field.label}
          style={{
            minWidth: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderLeft: `1px solid ${T.border}`,
            borderRight: `1px solid ${T.border}`,
            fontSize: 22,
            fontWeight: 900,
            color: T.text,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {n}
        </output>
        <button
          type="button"
          aria-label={`More: ${field.label}`}
          onClick={() => onChange(max == null ? n + 1 : Math.min(max, n + 1))}
          disabled={atTop}
          style={{ ...btn, opacity: atTop ? 0.35 : 1 }}
        >
          +
        </button>
      </div>
      {atTop && field.maxLabel && (
        <p style={{ marginTop: 6, fontSize: 13, color: T.textDim }}>{field.maxLabel}</p>
      )}
    </div>
  );
}
