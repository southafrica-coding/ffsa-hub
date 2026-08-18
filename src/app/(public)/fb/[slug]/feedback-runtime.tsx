"use client";

import { useMemo, useState } from "react";
import {
  allFields,
  type FeedbackSchema,
  type FeedbackField,
} from "@/lib/feedback/schema";
import { QuestionInput } from "@/components/feedback/question-input";
import { HubFormShell } from "./hub-shell";

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
  isAnonymous,
  thankYouHeading,
  thankYouMessage,
}: {
  slug: string;
  schema: FeedbackSchema;
  formTitle: string;
  intro: string | null;
  eventTitle: string;
  isAnonymous: boolean;
  thankYouHeading: string | null;
  thankYouMessage: string | null;
}) {
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
  const context = eventTitle
    ? `${eventTitle} · POST-EVENT FEEDBACK`
    : "POST-EVENT FEEDBACK";

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
      <HubFormShell context={context} title={thankYouHeading || "Thank you"}>
        <p className="max-w-[46ch] text-[15px] leading-relaxed text-[color:var(--text-secondary)]">
          {thankYouMessage ||
            "Your feedback is in. It goes straight to the people planning the next one — thank you for taking the time."}
        </p>
      </HubFormShell>
    );
  }

  if (totalSteps === 0) {
    return (
      <HubFormShell context={context} title={formTitle}>
        <p className="max-w-[46ch] text-[15px] leading-relaxed text-[color:var(--text-secondary)]">
          This form has no questions yet. Please check back shortly.
        </p>
      </HubFormShell>
    );
  }

  const onIdentityStep = !isAnonymous && stepIdx === 0;
  const section = sections[stepIdx - identitySteps];
  const isLastStep = stepIdx === totalSteps - 1;

  return (
    <HubFormShell
      context={context}
      title={formTitle}
      footerNote={isAnonymous ? "ANONYMOUS · NO NAME IS RECORDED" : null}
    >
      {/* Step counter + square rule bar, the Hub's own progress idiom. */}
      <div className="mb-7">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="mono-label">
            STEP {stepIdx + 1} OF {totalSteps}
          </span>
          <span className="mono-label">
            {onIdentityStep ? "ABOUT YOU" : section.title}
          </span>
        </div>
        <div className="bar">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>

      {stepIdx === 0 && intro?.trim() && (
        <p className="mb-7 max-w-[52ch] text-[15px] leading-relaxed text-[color:var(--text-secondary)]">
          {intro}
        </p>
      )}

      {onIdentityStep ? (
        <div className="space-y-6">
          <div>
            <label className="mono-label block">
              YOUR NAME<span className="ml-1 text-[color:#8A6400]">*</span>
            </label>
            <input
              className="mt-3 w-full"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((p) => ({ ...p, __name: "" }));
              }}
              placeholder="First and last name"
            />
            {errors.__name && (
              <p className="mono-label mt-2 text-destructive">{errors.__name}</p>
            )}
          </div>
          <div>
            <label className="mono-label block">YOUR EMAIL (OPTIONAL)</label>
            <input
              className="mt-3 w-full"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErrors((p) => ({ ...p, __email: "" }));
              }}
              placeholder="you@example.com"
            />
            <p className="mt-2 text-[12.5px] leading-relaxed text-[color:var(--text-tertiary)]">
              Only so we can follow up if something you raise needs a
              conversation.
            </p>
            {errors.__email && (
              <p className="mono-label mt-2 text-destructive">{errors.__email}</p>
            )}
          </div>
        </div>
      ) : (
        <>
          {section.description?.trim() && (
            <p className="mb-6 max-w-[52ch] text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
              {section.description}
            </p>
          )}
          <div className="space-y-7">
            {section.fields.map((field: FeedbackField) => (
              <QuestionInput
                key={field.id}
                field={field}
                value={values[field.id]}
                error={errors[field.id]}
                onChange={(v) => setValue(field.id, v)}
              />
            ))}
          </div>
        </>
      )}

      {submitError && (
        <p className="mt-6 border border-destructive px-3 py-2 text-[13px] text-destructive">
          {submitError}
        </p>
      )}

      <div className="mt-9 flex items-center justify-between gap-3 border-t border-rule pt-5">
        <button
          type="button"
          onClick={() => setStepIdx((i) => Math.max(i - 1, 0))}
          disabled={stepIdx === 0 || submitting}
          className="px-3 py-2 text-[color:var(--text-secondary)] hover:text-ink disabled:invisible"
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
          className="bg-ink px-6 py-3 text-white hover:bg-[#262622] disabled:bg-[color:var(--surface-4)]"
        >
          {submitting ? "Sending…" : isLastStep ? "Send feedback" : "Continue"}
        </button>
      </div>
    </HubFormShell>
  );
}
