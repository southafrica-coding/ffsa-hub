"use client";

import { useMemo, useRef, useState } from "react";
import {
  buildFieldsById,
  fieldKey,
  isFieldVisible,
  numericBounds,
  validateSubmission,
  type FormField,
  type FormSchema,
} from "@/lib/forms/schema";
import { NO_HELP_NEEDED } from "@/lib/forms/templates/missio-weekly-feedback";
import { GuideSurface, meetingLabel, pad2, type GuideTheme } from "./surface";
import styles from "./guide.module.css";

// ============================================================
// Weekly feedback — the leader's fill (F4, Brand Guide look)
// ============================================================
// Renders the form's own schema (the seeded row, or the template
// before it is seeded), so a question the builder adds still shows.
// Layout follows the approved mockup (fill.html): a lone headline
// stepper, then steppers in pairs, the 0–6 counts as rows, 1–5 scales
// as five boxes, picks as chips. The house and the Sunday come from
// the link or the login, never from a dropdown.
// ============================================================

export type WeeklyFillProps = {
  houseNumber: number;
  leaders: string | null;
  meetingDate: string;
  lastAttendance: number | null;
  initial: Record<string, unknown>;
  sentBefore: boolean;
  schema: FormSchema;
  /** POST target for { answers }. */
  endpoint: string;
  /** Top-bar link back to the house page (signed-in leaders only). */
  houseHref?: string | null;
  theme?: GuideTheme;
  /** Tests and screenshots: stands in for the POST. */
  submit?: (answers: Record<string, unknown>) => Promise<SubmitOutcome>;
};

export type SubmitOutcome = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> };

// ────────────────────────────────────────────────────────────
// Layout
// ────────────────────────────────────────────────────────────

export type Block =
  | { kind: "count"; field: FormField }
  | { kind: "pair"; a: FormField; b: FormField }
  | { kind: "fruit"; fields: FormField[] }
  | { kind: "field"; field: FormField };

/** A small stepper (0–6 style) reads as a row: label left, count right. */
const isFruit = (f: FormField) => f.type === "stepper" && f.max != null && f.max <= 10;
const isCount = (f: FormField) => f.type === "stepper" && !isFruit(f);

/** How a step's questions sit on a phone. Pure, so it is tested. */
export function planStep(fields: FormField[]): Block[] {
  const out: Block[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (isFruit(f)) {
      const last = out[out.length - 1];
      if (last?.kind === "fruit") last.fields.push(f);
      else out.push({ kind: "fruit", fields: [f] });
      continue;
    }
    if (isCount(f)) {
      const next = fields[i + 1];
      // The first count of a step is the headline; later ones pair up.
      if (i > 0 && next && isCount(next)) {
        out.push({ kind: "pair", a: f, b: next });
        i += 1;
      } else {
        out.push({ kind: "count", field: f });
      }
      continue;
    }
    out.push({ kind: "field", field: f });
  }
  return out;
}

/** Where the form starts: what was sent this week, else last week's count and zeros. */
export function startingAnswers(schema: FormSchema, initial: Record<string, unknown>, lastAttendance: number | null) {
  const values: Record<string, unknown> = {};
  for (const step of schema.steps) {
    for (const f of step.fields) {
      const key = fieldKey(f);
      if (initial[key] != null) values[key] = initial[key];
      else if (f.type === "stepper") values[key] = key === "attendance" && lastAttendance != null ? lastAttendance : numericBounds(f).min;
      else if (f.type === "multiselect") values[key] = [];
      else if (f.type === "checkbox") values[key] = false;
    }
  }
  return values;
}

function friendly(error: string): string {
  return /is required$/.test(error) ? "Please answer this one." : error;
}

// ────────────────────────────────────────────────────────────
// Controls
// ────────────────────────────────────────────────────────────

function Label({ field, id }: { field: FormField; id: string }) {
  return (
    <span className={styles.flabel} id={id}>
      {field.label}{" "}
      {field.required ? (
        <span className={styles.req} aria-hidden="true">
          *
        </span>
      ) : (
        <span className={styles.optional}>· optional</span>
      )}
    </span>
  );
}

function Stepper({
  field,
  value,
  onChange,
  wide,
  labelledBy,
}: {
  field: FormField;
  value: number;
  onChange: (n: number) => void;
  wide?: boolean;
  labelledBy: string;
}) {
  const { min, max } = numericBounds(field);
  const top = max ?? 500;
  const set = (n: number) => onChange(Math.max(min, Math.min(top, n)));
  return (
    <div className={`${styles.stepper} ${wide ? styles.stepperWide : ""}`} role="group" aria-labelledby={labelledBy}>
      <button type="button" className={styles.stepBtn} aria-label="One fewer" disabled={value <= min} onClick={() => set(value - 1)}>
        −
      </button>
      <input
        className={styles.stepVal}
        aria-labelledby={labelledBy}
        inputMode="numeric"
        pattern="[0-9]*"
        value={String(value)}
        onChange={(e) => set(Number(e.target.value.replace(/\D/g, "") || "0"))}
        onFocus={(e) => e.target.select()}
      />
      <button type="button" className={styles.stepBtn} aria-label="One more" disabled={value >= top} onClick={() => set(value + 1)}>
        +
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// The form
// ────────────────────────────────────────────────────────────

export function WeeklyFeedbackFill(props: WeeklyFillProps) {
  const { schema, houseNumber, leaders, meetingDate, lastAttendance, sentBefore, endpoint, houseHref, theme } = props;
  const [values, setValues] = useState<Record<string, unknown>>(() => startingAnswers(schema, props.initial, lastAttendance));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldsById = useMemo(() => buildFieldsById(schema), [schema]);
  const when = meetingLabel(meetingDate);
  const nav = { label: `House ${houseNumber}`, href: houseHref ?? undefined };

  const set = (key: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  /** Only what is on screen goes: a hidden name is never sent. */
  function visibleAnswers(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of fieldsById.values()) {
      if (!isFieldVisible(f, fieldsById, values)) continue;
      const k = fieldKey(f);
      const v = values[k];
      if (v == null || v === "") continue;
      out[k] = typeof v === "string" ? v.trim() : v;
    }
    return out;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const answers = visibleAnswers();
    const checked = validateSubmission(schema, answers, { requireContactField: false });
    if (!checked.valid) {
      setErrors(checked.errors);
      setAlert("A few answers are missing. They are marked in orange.");
      requestAnimationFrame(() => {
        const first = formRef.current?.querySelector("[data-invalid='true']") as HTMLElement | null;
        first?.scrollIntoView?.({ block: "center" });
      });
      return;
    }
    setPending(true);
    setAlert(null);
    try {
      const outcome = await (props.submit ?? defaultSubmit(endpoint))(answers);
      if (outcome.ok) {
        setSent(true);
        if (typeof window !== "undefined") window.scrollTo?.(0, 0);
      } else {
        setErrors(outcome.fieldErrors ?? {});
        setAlert(outcome.error);
      }
    } catch {
      setAlert("That didn’t send. Check your signal and try again.");
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <GuideSurface nav={nav} theme={theme} state="sent">
        <main className={styles.intro}>
          <p className={styles.eyebrow}>
            House {houseNumber} · {when.day} {when.date}
          </p>
          <h1 className={styles.h1}>
            Thank <em>you.</em>
          </h1>
          <p className={styles.lede}>{schema.thankYou?.message || "We are praying for you and your house church this week."}</p>
          <p className={styles.lede}>Your coach and the pastors have it. If something changes, send it again: it updates this week.</p>
          <button type="button" className={styles.quietBtn} onClick={() => setSent(false)}>
            Change what I sent
          </button>
        </main>
      </GuideSurface>
    );
  }

  const control = (f: FormField) => {
    const key = fieldKey(f);
    const id = `wf-${f.id}`;
    const v = values[key];
    const err = errors[key];
    const errNode = err ? (
      <p className={styles.err} role="alert">
        {friendly(err)}
      </p>
    ) : null;
    const help = f.helpText ? (
      <p className={styles.help}>
        {key === "attendance" && lastAttendance != null ? `${f.helpText} Last week: ${lastAttendance}.` : f.helpText}
      </p>
    ) : null;

    switch (f.type) {
      case "checkbox": {
        const on = v === true;
        return (
          <div className={styles.opt} data-invalid={Boolean(err)}>
            <button type="button" className={styles.optBtn} role="checkbox" aria-checked={on} onClick={() => set(key, !on)}>
              <span className={`${styles.box} ${on ? styles.boxOn : ""}`} aria-hidden="true" />
              <span>{f.label}</span>
            </button>
            {help}
            {errNode}
          </div>
        );
      }
      case "linear_scale": {
        const { min, max } = numericBounds(f);
        const points = Array.from({ length: (max ?? 5) - min + 1 }, (_, i) => min + i);
        return (
          <div className={styles.field} data-invalid={Boolean(err)}>
            <Label field={f} id={id} />
            <div className={styles.scale} role="radiogroup" aria-labelledby={id}>
              {points.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={v === n}
                  className={`${styles.scaleBtn} ${v === n ? styles.on : ""}`}
                  onClick={() => set(key, n)}
                >
                  {n}
                </button>
              ))}
            </div>
            {f.minLabel || f.maxLabel ? (
              <div className={styles.ends} aria-hidden="true">
                <span>{f.minLabel}</span>
                <span>{f.maxLabel}</span>
              </div>
            ) : null}
            {help}
            {errNode}
          </div>
        );
      }
      case "multiselect":
      case "radio": {
        const picked = Array.isArray(v) ? (v as string[]) : typeof v === "string" ? [v] : [];
        const toggle = (opt: string) => {
          if (f.type === "radio") return set(key, opt);
          if (picked.includes(opt)) return set(key, picked.filter((p) => p !== opt));
          // "No help needed" and a need cannot both be true.
          if (opt === NO_HELP_NEEDED) return set(key, [opt]);
          return set(key, [...picked.filter((p) => p !== NO_HELP_NEEDED), opt]);
        };
        return (
          <div className={styles.field} data-invalid={Boolean(err)}>
            <Label field={f} id={id} />
            <div className={styles.chips} role="group" aria-labelledby={id}>
              {(f.options ?? []).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={picked.includes(opt)}
                  className={`${styles.chip} ${picked.includes(opt) ? styles.on : ""}`}
                  onClick={() => toggle(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
            {help}
            {errNode}
          </div>
        );
      }
      case "dropdown":
        return (
          <div className={styles.field} data-invalid={Boolean(err)}>
            <Label field={f} id={id} />
            <span className={styles.selectWrap}>
              <select id={`${id}-in`} aria-labelledby={id} className={styles.select} value={typeof v === "string" ? v : ""} onChange={(e) => set(key, e.target.value)}>
                <option value="">Choose one</option>
                {(f.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </span>
            {help}
            {errNode}
          </div>
        );
      case "long_text":
        return (
          <div className={styles.field} data-invalid={Boolean(err)}>
            <Label field={f} id={id} />
            <textarea
              id={`${id}-in`}
              aria-labelledby={id}
              className={`${styles.textarea} ${f.required ? "" : styles.short}`}
              maxLength={2000}
              value={typeof v === "string" ? v : ""}
              onChange={(e) => set(key, e.target.value)}
            />
            {help}
            {errNode}
          </div>
        );
      case "stepper":
        return (
          <div className={styles.field} data-invalid={Boolean(err)}>
            <Label field={f} id={id} />
            <Stepper field={f} value={Number(v ?? 0)} onChange={(n) => set(key, n)} labelledBy={id} />
            {help}
            {errNode}
          </div>
        );
      default:
        return (
          <div className={styles.field} data-invalid={Boolean(err)}>
            <Label field={f} id={id} />
            <input
              id={`${id}-in`}
              aria-labelledby={id}
              className={styles.text}
              type={f.type === "email" ? "email" : f.type === "phone" ? "tel" : f.type === "date" ? "date" : "text"}
              autoComplete="off"
              maxLength={200}
              value={typeof v === "string" ? v : ""}
              onChange={(e) => set(key, e.target.value)}
            />
            {help}
            {errNode}
          </div>
        );
    }
  };

  const countField = (f: FormField, wide: boolean) => {
    const key = fieldKey(f);
    const id = `wf-${f.id}`;
    const err = errors[key];
    return (
      <div className={styles.field} data-invalid={Boolean(err)} key={f.id}>
        <Label field={f} id={id} />
        <Stepper field={f} value={Number(values[key] ?? 0)} onChange={(n) => set(key, n)} wide={wide} labelledBy={id} />
        {f.helpText ? (
          <p className={styles.help}>
            {key === "attendance" && lastAttendance != null ? `${f.helpText} Last week: ${lastAttendance}.` : f.helpText}
          </p>
        ) : null}
        {err ? (
          <p className={styles.err} role="alert">
            {friendly(err)}
          </p>
        ) : null}
      </div>
    );
  };

  const shown = (f: FormField) => isFieldVisible(f, fieldsById, values);

  return (
    <GuideSurface nav={nav} theme={theme} state="form">
      <form ref={formRef} onSubmit={(e) => void onSubmit(e)} noValidate data-testid="weekly-feedback-form">
        <main>
          <div className={styles.intro}>
            <p className={styles.eyebrow}>01 / Weekly feedback</p>
            <h1 className={styles.h1}>
              How was it <em>this {when.day || "week"}?</em>
            </h1>
            <p className={styles.lede}>
              {leaders ? `${leaders}. ` : ""}Fill this in once for the house, about five minutes. Please do not write names of guests or
              personal details.
            </p>
            <p className={`${styles.meta} ${styles.nums}`}>
              <b>
                {when.day} · {when.date}
              </b>{" "}
              · House {houseNumber}
            </p>
            {sentBefore ? <p className={styles.meta}>You already sent this week. Change anything and send again.</p> : null}
          </div>

          {schema.steps.map((step, si) => (
            <section key={step.id} aria-labelledby={`wf-step-${step.id}`}>
              <h2 className={styles.sect} id={`wf-step-${step.id}`}>
                <span className={styles.sectN}>
                  {pad2(si + 2)} / {step.title}
                </span>
              </h2>
              <div className={styles.pad}>
                {planStep(step.fields.filter(shown)).map((block) => {
                  if (block.kind === "count") return countField(block.field, false);
                  if (block.kind === "pair") {
                    return (
                      <div className={styles.two} key={block.a.id}>
                        {countField(block.a, true)}
                        {countField(block.b, true)}
                      </div>
                    );
                  }
                  if (block.kind === "fruit") {
                    const first = block.fields[0];
                    const { max } = numericBounds(first);
                    const fruitErr = block.fields.map((f) => errors[fieldKey(f)]).find(Boolean);
                    return (
                      <div key={first.id}>
                        {block.fields.map((f) => {
                          const id = `wf-${f.id}`;
                          return (
                            <div className={styles.fruit} key={f.id} data-invalid={Boolean(errors[fieldKey(f)])}>
                              <span id={id}>{f.label}</span>
                              <Stepper field={f} value={Number(values[fieldKey(f)] ?? 0)} onChange={(n) => set(fieldKey(f), n)} labelledBy={id} />
                            </div>
                          );
                        })}
                        {first.maxLabel && max != null ? (
                          <p className={styles.help}>
                            Use {max} for {first.maxLabel.toLowerCase()}.
                          </p>
                        ) : null}
                        {fruitErr ? <p className={styles.err}>{friendly(fruitErr)}</p> : null}
                      </div>
                    );
                  }
                  const f = block.field;
                  const node = control(f);
                  return f.parentFieldId ? (
                    <div className={styles.shared} key={f.id}>
                      {node}
                    </div>
                  ) : (
                    <div key={f.id}>{node}</div>
                  );
                })}
              </div>
            </section>
          ))}
        </main>
        <div className={styles.sticky} data-sticky="">
          {alert ? (
            <p className={styles.alert} role="alert">
              {alert}
            </p>
          ) : null}
          <button type="submit" className={styles.sendBtn} disabled={pending}>
            {pending ? "Sending…" : "Send to your coach and the pastors"}
          </button>
        </div>
      </form>
    </GuideSurface>
  );
}

function defaultSubmit(endpoint: string) {
  return async (answers: Record<string, unknown>): Promise<SubmitOutcome> => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ answers }),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: string; fieldErrors?: Record<string, string> };
    return { ok: false, error: body.error ?? "That didn’t send. Try again in a minute.", fieldErrors: body.fieldErrors };
  };
}
