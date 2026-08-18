"use client";

import { useMemo, useState } from "react";
import {
  allFields,
  type FeedbackSchema,
  type FeedbackField,
} from "@/lib/feedback/schema";
import { QuestionInput } from "@/components/feedback/question-input";
import {
  PublicFormShell,
  PublicFormInputStyles,
  tokensForBrand,
  type PublicShellBrand,
} from "@/components/public-form-shell";

type Values = Record<string, unknown>;

// One section per step. On a named form an extra "About you" step is
// prepended — asking who someone is at the END of a survey reads as an
// afterthought, and asking it at all on an anonymous form would be a lie.
export function FeedbackRuntime({
  slug,
  schema,
  formTitle,
  intro,
  eventTitle,
  eventLogoUrl,
  brand = "ff",
  isAnonymous,
  thankYouHeading,
  thankYouMessage,
}: {
  slug: string;
  schema: FeedbackSchema;
  formTitle: string;
  intro: string | null;
  eventTitle: string;
  eventLogoUrl?: string | null;
  brand?: PublicShellBrand;
  isAnonymous: boolean;
  thankYouHeading: string | null;
  thankYouMessage: string | null;
}) {
  const T = tokensForBrand(brand);
  const subBrandLogoUrl =
    brand === "the_send" || brand === "ffsa_camps" ? null : eventLogoUrl || null;

  const sections = useMemo(
    () => schema.sections.filter((s) => s.fields.length > 0),
    [schema]
  );
  // Step 0 is the identity step on a named form; sections follow.
  const identitySteps = isAnonymous ? 0 : 1;
  const totalSteps = sections.length + identitySteps;

  const [stepIdx, setStepIdx] = useState(0);
  const [values, setValues] = useState<Values>({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const progress = Math.round(((stepIdx + 1) / Math.max(totalSteps, 1)) * 100);

  function setValue(id: string, v: unknown) {
    setValues((prev) => ({ ...prev, [id]: v }));
    setErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function isBlank(v: unknown): boolean {
    return (
      v === null ||
      v === undefined ||
      v === "" ||
      (Array.isArray(v) && v.length === 0)
    );
  }

  function validateStep(): boolean {
    const stepErrors: Record<string, string> = {};

    if (!isAnonymous && stepIdx === 0) {
      if (!name.trim()) stepErrors.__name = "Please tell us your name.";
      if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        stepErrors.__email = "That email address doesn't look right.";
      }
      setErrors(stepErrors);
      return Object.keys(stepErrors).length === 0;
    }

    const section = sections[stepIdx - identitySteps];
    for (const field of section?.fields ?? []) {
      if (field.required && isBlank(values[field.id])) {
        stepErrors[field.id] = "This question needs an answer.";
      }
    }
    setErrors(stepErrors);
    return Object.keys(stepErrors).length === 0;
  }

  async function submit() {
    if (!validateStep()) return;
    setSubmitting(true);
    setSubmitError(null);

    // Only send answers to questions that still exist in the schema — a
    // question deleted mid-collection shouldn't leave orphan keys behind.
    const payload: Values = {};
    for (const field of allFields(schema)) {
      if (field.id in values && !isBlank(values[field.id])) {
        payload[field.id] = values[field.id];
      }
    }

    const res = await fetch(`/api/fb/${slug}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: payload,
        respondentName: isAnonymous ? undefined : name.trim(),
        respondentEmail: isAnonymous ? undefined : email.trim() || undefined,
      }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        fieldErrors?: Record<string, string>;
      };
      if (data.fieldErrors) setErrors(data.fieldErrors);
      setSubmitError(data.error ?? "Something went wrong. Please try again.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <PublicFormShell
        eyebrow="Thank you"
        heading={thankYouHeading || "Thank you"}
        maxWidth={520}
        brand={brand}
      >
        <p style={{ fontSize: 15, color: T.textDim, lineHeight: 1.6, margin: 0 }}>
          {thankYouMessage ||
            "Your feedback is in. It goes straight to the people planning the next one — thank you for taking the time."}
        </p>
      </PublicFormShell>
    );
  }

  if (totalSteps === 0) {
    return (
      <PublicFormShell eyebrow="Feedback" heading={formTitle} maxWidth={520} brand={brand}>
        <p style={{ fontSize: 15, color: T.textDim, lineHeight: 1.6, margin: 0 }}>
          This form has no questions yet. Please check back shortly.
        </p>
      </PublicFormShell>
    );
  }

  const onIdentityStep = !isAnonymous && stepIdx === 0;
  const section = sections[stepIdx - identitySteps];
  const isLastStep = stepIdx === totalSteps - 1;
  const heading = onIdentityStep ? "About you" : section.title;

  return (
    <div className="ffsa-public">
      <PublicFormInputStyles brand={brand} />
      <PublicFormShell
        eyebrow={`Step ${stepIdx + 1} of ${totalSteps}`}
        heading={heading}
        maxWidth={520}
        footerNote={eventTitle ? `${eventTitle} · ${formTitle}` : formTitle}
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

        <div
          className="mb-7 overflow-hidden"
          style={{ background: T.borderSoft, height: 6 }}
        >
          <div
            style={{
              height: "100%",
              width: `${progress}%`,
              background: T.yellow,
              transition: "width .3s ease",
            }}
          />
        </div>

        {/* The intro only belongs on the first screen. */}
        {stepIdx === 0 && intro?.trim() && (
          <p
            style={{
              fontSize: 14.5,
              color: T.textDim,
              lineHeight: 1.6,
              margin: "0 0 22px",
            }}
          >
            {intro}
          </p>
        )}

        {onIdentityStep ? (
          <div className="space-y-5">
            <div>
              <label className="ffsa-public-label ffsa-public-label-required">
                Your name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setErrors((p) => ({ ...p, __name: "" }));
                }}
                placeholder="First and last name"
              />
              {errors.__name && <p className="ffsa-public-error">{errors.__name}</p>}
            </div>
            <div>
              <label className="ffsa-public-label">Your email (optional)</label>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setErrors((p) => ({ ...p, __email: "" }));
                }}
                placeholder="you@example.com"
              />
              <p style={{ fontSize: 12, color: T.textDim, marginTop: 6, lineHeight: 1.5 }}>
                Only so we can follow up if something you raise needs a
                conversation.
              </p>
              {errors.__email && <p className="ffsa-public-error">{errors.__email}</p>}
            </div>
          </div>
        ) : (
          <>
            {section.description?.trim() && (
              <p
                style={{
                  fontSize: 14,
                  color: T.textDim,
                  lineHeight: 1.6,
                  margin: "0 0 20px",
                }}
              >
                {section.description}
              </p>
            )}
            <div className="space-y-6">
              {section.fields.map((field: FeedbackField) => (
                <QuestionInput
                  key={field.id}
                  field={field}
                  value={values[field.id]}
                  error={errors[field.id]}
                  onChange={(v) => setValue(field.id, v)}
                  tokens={T}
                />
              ))}
            </div>
          </>
        )}

        {submitError && (
          <p
            className="mt-5 px-3 py-2"
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
            onClick={() => setStepIdx((i) => Math.max(i - 1, 0))}
            disabled={stepIdx === 0 || submitting}
            className="ffsa-public-btn-ghost disabled:opacity-0"
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={() => {
              if (isLastStep) {
                void submit();
              } else if (validateStep()) {
                setStepIdx((i) => Math.min(i + 1, totalSteps - 1));
              }
            }}
            disabled={submitting}
            className="ffsa-public-btn-primary"
          >
            {submitting ? "Sending…" : isLastStep ? "Send feedback" : "Continue"}
          </button>
        </div>
      </PublicFormShell>
    </div>
  );
}
