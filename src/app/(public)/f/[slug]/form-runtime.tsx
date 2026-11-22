"use client";

import { useMemo, useState } from "react";
import {
  type FormSchema,
  type FormField,
  fieldKey,
  buildFieldsById,
  isFieldVisible,
  numericBounds,
} from "@/lib/forms/schema";
import { LinearScaleInput, StepperInput } from "./numeric-fields";
import { DateInput } from "@/components/ui/date-input";
import {
  PublicFormShell,
  PublicFormInputStyles,
  tokensForBrand,
  type PublicShellBrand,
} from "@/components/public-form-shell";

type Values = Record<string, unknown>;

/**
 * A counter always shows a number, so it starts at its lowest value and
 * that is the answer unless they change it.
 */
export function initialValues(schema: FormSchema): Values {
  const out: Values = {};
  for (const step of schema.steps) {
    for (const field of step.fields) {
      if (field.type === "stepper") out[fieldKey(field)] = numericBounds(field).min;
    }
  }
  return out;
}

export function FormRuntime({
  slug,
  schema,
  formName,
  eventLogoUrl,
  brand = "ff",
}: {
  slug: string;
  schema: FormSchema;
  formName: string;
  eventLogoUrl?: string | null;
  brand?: PublicShellBrand;
}) {
  // Always use the brand-specific accent — accentColor in the form schema
  // is intentionally ignored on the public surface so each event reads
  // as one identity (storefront + form + email all agree).
  const T = tokensForBrand(brand);
  const ACCENT = T.yellow;
  // Event/form-specific logo is shown inside the card as a sub-brand, not
  // replacing the FF wordmark in the shell header.
  //
  // SEND + FFSA Camps skip the sub-brand — their lockup is already in the
  // page header, and a default FF wordmark renders illegibly on their
  // cream cards.
  const subBrandLogoUrl =
    brand === "the_send" || brand === "ffsa_camps"
      ? null
      : eventLogoUrl || schema.branding.logoUrl || null;
  const steps = schema.steps;
  const [stepIdx, setStepIdx] = useState(0);
  const [values, setValues] = useState<Values>(() => initialValues(schema));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const progress = useMemo(
    () => Math.round(((stepIdx + 1) / Math.max(steps.length, 1)) * 100),
    [stepIdx, steps.length]
  );

  const fieldsById = useMemo(() => buildFieldsById(schema), [schema]);

  function setValue(key: string, v: unknown) {
    setValues((prev) => ({ ...prev, [key]: v }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function validateStep(): boolean {
    const step = steps[stepIdx];
    const stepErrors: Record<string, string> = {};
    for (const field of step.fields) {
      // Conditional fields whose rule isn't met don't block progression.
      if (!isFieldVisible(field, fieldsById, values)) continue;
      const k = fieldKey(field);
      const raw = values[k];
      const empty =
        raw == null ||
        raw === "" ||
        (Array.isArray(raw) && raw.length === 0) ||
        ((field.type === "checkbox" || field.type === "consent") && raw !== true);
      if (field.required && empty) {
        stepErrors[k] = `${field.label} is required`;
        continue;
      }
      if (!empty && field.type === "email" && typeof raw === "string") {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim())) {
          stepErrors[k] = "Enter a valid email address";
        }
      }
      if (!empty && (field.type === "linear_scale" || field.type === "stepper")) {
        const { min, max } = numericBounds(field);
        const n = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isInteger(n) || n < min || (max != null && n > max)) {
          stepErrors[k] = max != null ? `Pick a number from ${min} to ${max}` : `Enter ${min} or more`;
        }
      }
    }
    setErrors(stepErrors);
    return Object.keys(stepErrors).length === 0;
  }

  function next() {
    if (!validateStep()) return;
    setStepIdx((i) => Math.min(i + 1, steps.length - 1));
  }
  function prev() {
    setStepIdx((i) => Math.max(i - 1, 0));
  }

  async function submit() {
    if (!validateStep()) return;
    setSubmitting(true);
    setSubmitError(null);
    // Drop answers belonging to fields hidden by an unmet conditional
    // rule. The user may have filled a child, then changed the parent —
    // sending the stale answer would store ghost data and confuse the
    // server validator's matching logic.
    const payload: Values = {};
    for (const step of schema.steps) {
      for (const field of step.fields) {
        if (!isFieldVisible(field, fieldsById, values)) continue;
        const k = fieldKey(field);
        if (k in values) payload[k] = values[k];
      }
    }
    const res = await fetch(`/api/f/${slug}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: payload }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        fieldErrors?: Record<string, string>;
      };
      if (data.fieldErrors) setErrors(data.fieldErrors);
      setSubmitError(data.error ?? "Submission failed. Please try again.");
      return;
    }
    const result = (await res.json()) as { redirectUrl?: string | null };
    if (result.redirectUrl) {
      window.location.href = result.redirectUrl;
      return;
    }
    setDone(true);
  }

  const isLastStep = stepIdx === steps.length - 1;
  const step = steps[stepIdx];

  if (done) {
    return (
      <PublicFormShell
        eyebrow="Thank You"
        heading={schema.thankYou.heading}
        maxWidth={520}
        brand={brand}
      >
        <p
          style={{
            fontSize: 15,
            color: T.textDim,
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          {schema.thankYou.message}
        </p>
      </PublicFormShell>
    );
  }

  return (
    <div className="ffsa-public">
      <PublicFormInputStyles brand={brand} />
      <PublicFormShell
        eyebrow={`Step ${stepIdx + 1} of ${steps.length}`}
        heading={step.title}
        maxWidth={520}
        footerNote={formName}
        brand={brand}
      >
        {subBrandLogoUrl && (
          <div className="mb-6 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={subBrandLogoUrl}
              alt=""
              style={{ height: 36, objectFit: "contain", maxWidth: "60%" }}
            />
          </div>
        )}

        {/* Progress bar */}
        <div
          className="mb-7 h-1.5 rounded-full overflow-hidden"
          style={{ background: T.borderSoft }}
        >
          <div
            style={{
              height: "100%",
              width: `${progress}%`,
              background: ACCENT,
              transition: "width .3s ease",
              borderRadius: 999,
            }}
          />
        </div>

        {/* Fields */}
        <div className="space-y-5">
          {step.fields.map((field) => {
            if (!isFieldVisible(field, fieldsById, values)) return null;
            return (
              <FieldInput
                key={field.id}
                field={field}
                value={values[fieldKey(field)]}
                error={errors[fieldKey(field)]}
                onChange={(v) => setValue(fieldKey(field), v)}
                tokens={T}
              />
            );
          })}
        </div>

        {submitError && (
          <p
            className="mt-5 rounded-lg px-3 py-2"
            style={{
              fontSize: 13,
              color: T.red,
              background: `${T.red}1a`,
              border: `1px solid ${T.red}33`,
            }}
          >
            {submitError}
          </p>
        )}

        <div className="flex items-center justify-between mt-8 gap-3">
          <button
            type="button"
            onClick={prev}
            disabled={stepIdx === 0 || submitting}
            className="ffsa-public-btn-ghost disabled:opacity-0"
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={isLastStep ? submit : next}
            disabled={submitting}
            className="ffsa-public-btn-primary"
          >
            {submitting
              ? "Submitting…"
              : isLastStep
              ? "Submit"
              : "Continue"}
          </button>
        </div>
      </PublicFormShell>
    </div>
  );
}

function FieldInput({
  field,
  value,
  error,
  onChange,
  tokens: T,
}: {
  field: FormField;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
  tokens: ReturnType<typeof tokensForBrand>;
}) {
  const labelEl = (
    <label
      className={`ffsa-public-label ${
        field.required ? "ffsa-public-label-required" : ""
      }`}
    >
      {field.label}
    </label>
  );
  const str = typeof value === "string" ? value : "";
  const errEl = error ? <p className="ffsa-public-error">{error}</p> : null;

  // ── checkbox / consent / outcome — selectable cards ──────────
  if (
    field.type === "checkbox" ||
    field.type === "consent" ||
    field.type === "outcome"
  ) {
    const checked = value === true;
    const isOutcome = field.type === "outcome";
    return (
      <div>
        <label
          className={`ffsa-public-card flex items-start gap-3 cursor-pointer ${
            checked ? "is-selected" : ""
          }`}
          style={{
            padding: isOutcome ? "14px 16px" : "12px 14px",
          }}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            style={{
              marginTop: 2,
              width: 17,
              height: 17,
              accentColor: T.yellow,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 14,
              color: T.text,
              fontWeight: isOutcome ? 600 : 400,
              lineHeight: 1.45,
            }}
          >
            {field.label}
            {field.required && (
              <span style={{ color: T.red }}> *</span>
            )}
          </span>
        </label>
        {errEl}
      </div>
    );
  }

  let control: React.ReactNode = null;

  if (field.type === "linear_scale") {
    control = <LinearScaleInput field={field} value={value} onChange={onChange} tokens={T} />;
  } else if (field.type === "stepper") {
    control = <StepperInput field={field} value={value} onChange={onChange} tokens={T} />;
  } else if (field.type === "date") {
    control = <DateInput value={str} onChange={(v) => onChange(v)} />;
  } else if (
    field.type === "text" ||
    field.type === "email" ||
    field.type === "phone" ||
    field.type === "number"
  ) {
    const htmlType =
      field.type === "email"
        ? "email"
        : field.type === "phone"
        ? "tel"
        : field.type === "number"
        ? "number"
        : "text";
    control = (
      <input
        type={htmlType}
        value={str}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  } else if (field.type === "long_text") {
    control = (
      <textarea
        value={str}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        style={{ resize: "none" }}
      />
    );
  } else if (field.type === "dropdown") {
    control = (
      <select value={str} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  } else if (field.type === "radio" || field.type === "yes_no") {
    const opts =
      field.type === "yes_no"
        ? ["Yes", "No"]
        : field.options ?? [];
    control = (
      <div className="space-y-2">
        {opts.map((o) => {
          const sel = value === o;
          return (
            <label
              key={o}
              className={`ffsa-public-card flex items-center gap-3 cursor-pointer text-sm ${
                sel ? "is-selected" : ""
              }`}
              style={{ padding: "11px 14px" }}
            >
              <input
                type="radio"
                name={field.id}
                checked={sel}
                onChange={() => onChange(o)}
                style={{ accentColor: T.yellow, flexShrink: 0 }}
              />
              <span style={{ color: T.text }}>{o}</span>
            </label>
          );
        })}
      </div>
    );
  } else if (field.type === "multiselect") {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    control = (
      <div className="space-y-2">
        {(field.options ?? []).map((o) => {
          const sel = arr.includes(o);
          return (
            <label
              key={o}
              className={`ffsa-public-card flex items-center gap-3 cursor-pointer text-sm ${
                sel ? "is-selected" : ""
              }`}
              style={{ padding: "11px 14px" }}
            >
              <input
                type="checkbox"
                checked={sel}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...arr, o]
                      : arr.filter((x) => x !== o)
                  )
                }
                style={{ accentColor: T.yellow, flexShrink: 0 }}
              />
              <span style={{ color: T.text }}>{o}</span>
            </label>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      {labelEl}
      {control}
      {errEl}
    </div>
  );
}
