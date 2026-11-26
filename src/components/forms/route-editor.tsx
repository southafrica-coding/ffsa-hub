"use client";

import { useState } from "react";
import {
  CONTACT_FIELD_KEYS,
  FORM_ROUTE_ACTIONS,
  FORM_ROUTE_WHENS,
  type FormField,
  type FormRoute,
  type FormRouteAction,
  type FormRouteWhen,
} from "@/lib/forms/schema";
import {
  NUMERIC_TYPES,
  ROUTE_ACTION_LABELS,
  ROUTE_TARGET_PROMPTS,
  ROUTE_WHEN_LABELS,
  describeRouteThen,
  describeRouteWhen,
} from "./describe";

// ============================================================
// Route to — the editor for one question's routes[]
// ============================================================
// This only edits what is stored on the schema. Nothing here (or
// anywhere in F2) acts on a route: the runner that writes columns,
// opens follow-ups, posts to the Care board or Slack is F3.
// ============================================================

const INPUT =
  "min-h-11 w-full border border-[color:var(--rule-strong)] bg-[color:var(--surface-1,#fff)] px-3 py-2 text-[15px] font-normal normal-case tracking-normal";

/** Answers a choice question can give, for the "when" value picker. */
function choicesFor(field: FormField): string[] {
  if (field.type === "yes_no") return ["Yes", "No"];
  if (field.type === "dropdown" || field.type === "radio" || field.type === "multiselect") {
    return field.options ?? [];
  }
  return [];
}

/** Which rules make sense for this question type. */
export function whensFor(field: FormField): FormRouteWhen[] {
  const numeric = NUMERIC_TYPES.includes(field.type) || field.type === "number";
  if (field.type === "multiselect") return ["always", "includes", "in"];
  if (numeric) return ["always", "equals", "not_equals", "gt", "lt", "in"];
  return ["always", "equals", "not_equals", "in"];
}

/** A new route starts as the most common case: when the answer is…, Slack. */
export function newRoute(field: FormField): FormRoute {
  return { action: "slack", target: "", when: whensFor(field).includes("in") ? "in" : "always", whenValue: [] };
}

function toAnswer(raw: string, numeric: boolean): string | number {
  const t = raw.trim();
  if (numeric && t !== "" && Number.isFinite(Number(t))) return Number(t);
  return t;
}

export function RoutesEditor({
  field,
  onChange,
}: {
  field: FormField;
  onChange: (routes: FormRoute[]) => void;
}) {
  const routes = field.routes ?? [];
  function update(i: number, patch: Partial<FormRoute>) {
    onChange(routes.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  return (
    <div className="space-y-2.5">
      {routes.length === 0 && (
        <p className="text-[13px] text-[color:var(--text-tertiary)]">
          No extra routes. The answer is only kept with the response.
        </p>
      )}
      {routes.map((route, i) => (
        <RouteCard
          key={i}
          index={i}
          field={field}
          route={route}
          onChange={(patch) => update(i, patch)}
          onRemove={() => onChange(routes.filter((_, j) => j !== i))}
        />
      ))}
      <button
        type="button"
        onClick={() => onChange([...routes, newRoute(field)])}
        className="min-h-11 w-full border border-[color:var(--rule-strong)] px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] hover:bg-bone"
      >
        {routes.length === 0 ? "Add a route" : "Add another route"}
      </button>
    </div>
  );
}

function RouteCard({
  index,
  field,
  route,
  onChange,
  onRemove,
}: {
  index: number;
  field: FormField;
  route: FormRoute;
  onChange: (patch: Partial<FormRoute>) => void;
  onRemove: () => void;
}) {
  const numeric = NUMERIC_TYPES.includes(field.type) || field.type === "number";
  const choices = choicesFor(field);
  const whens = whensFor(field);
  const targetPrompt = ROUTE_TARGET_PROMPTS[route.action];
  const n = index + 1;

  return (
    <div
      className="border border-[color:var(--rule-strong)] bg-bone p-3"
      data-testid={`route-${index}`}
    >
      <p className="text-[13px] text-[color:var(--text-secondary)]">{describeRouteWhen(route)}</p>
      <p className="mt-0.5 text-[14px] font-bold leading-snug">{describeRouteThen(route)}</p>

      <div className="mt-3 grid gap-2.5">
        <label className="block">
          <span className="mono-label">When</span>
          <select
            aria-label={`Route ${n} rule`}
            value={route.when}
            onChange={(e) => {
              const when = e.target.value as FormRouteWhen;
              onChange({
                when,
                whenValue: when === "always" ? null : when === "in" ? [] : null,
              });
            }}
            className={`${INPUT} mt-1`}
          >
            {FORM_ROUTE_WHENS.filter((w) => whens.includes(w) || w === route.when).map((w) => (
              <option key={w} value={w}>
                {ROUTE_WHEN_LABELS[w]}
              </option>
            ))}
          </select>
        </label>

        {route.when !== "always" && (
          <WhenValueInput
            key={route.when}
            n={n}
            route={route}
            numeric={numeric}
            choices={choices}
            onChange={(whenValue) => onChange({ whenValue })}
          />
        )}

        <label className="block">
          <span className="mono-label">Then</span>
          <select
            aria-label={`Route ${n} action`}
            value={route.action}
            onChange={(e) => {
              const action = e.target.value as FormRouteAction;
              onChange({ action, target: ROUTE_TARGET_PROMPTS[action] ? route.target ?? "" : null });
            }}
            className={`${INPUT} mt-1`}
          >
            {FORM_ROUTE_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ROUTE_ACTION_LABELS[a]}
              </option>
            ))}
          </select>
        </label>

        {targetPrompt &&
          (route.action === "create_or_update_contact" ? (
            <select
              aria-label={`Route ${n} target`}
              value={route.target ?? ""}
              onChange={(e) => onChange({ target: e.target.value || null })}
              className={INPUT}
            >
              <option value="">Pick a contact field</option>
              {CONTACT_FIELD_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          ) : (
            <input
              aria-label={`Route ${n} target`}
              value={route.target ?? ""}
              placeholder={targetPrompt}
              onChange={(e) => onChange({ target: e.target.value })}
              className={INPUT}
            />
          ))}

        {route.action === "slack" && (
          <p className="text-[12px] leading-snug text-[color:var(--text-tertiary)]">
            Saved with the form only. Slack stays off until it is switched on, and no message is
            sent from this screen.
          </p>
        )}
        {route.action !== "slack" && route.action !== "store" && (
          <p className="text-[12px] leading-snug text-[color:var(--text-tertiary)]">
            Saved with the form. It starts working when the route runner is switched on.
          </p>
        )}

        <button
          type="button"
          onClick={onRemove}
          className="min-h-11 justify-self-start px-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--text-secondary)] hover:text-destructive"
        >
          Remove route
        </button>
      </div>
    </div>
  );
}

function WhenValueInput({
  n,
  route,
  numeric,
  choices,
  onChange,
}: {
  n: number;
  route: FormRoute;
  numeric: boolean;
  choices: string[];
  onChange: (v: FormRoute["whenValue"]) => void;
}) {
  // A list rule keeps its own text so typing "1, " doesn't lose the comma.
  const initial = Array.isArray(route.whenValue)
    ? route.whenValue.join(", ")
    : route.whenValue == null
      ? ""
      : String(route.whenValue);
  const [text, setText] = useState(initial);

  if (route.when === "in") {
    if (choices.length > 0) {
      const picked = Array.isArray(route.whenValue) ? route.whenValue.map(String) : [];
      return (
        <fieldset className="flex flex-wrap gap-1.5" aria-label={`Route ${n} answers`}>
          {choices.map((c) => {
            const on = picked.includes(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? picked.filter((p) => p !== c) : [...picked, c])}
                className={`min-h-11 border px-3 text-[13px] ${
                  on ? "border-ink bg-ink text-white" : "border-[color:var(--rule-strong)]"
                }`}
              >
                {c}
              </button>
            );
          })}
        </fieldset>
      );
    }
    return (
      <input
        aria-label={`Route ${n} answers`}
        value={text}
        placeholder={numeric ? "e.g. 1, 2" : "Answers, separated by commas"}
        inputMode={numeric ? "numeric" : undefined}
        onChange={(e) => {
          setText(e.target.value);
          onChange(
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .map((s) => toAnswer(s, numeric))
          );
        }}
        className={INPUT}
      />
    );
  }

  if (choices.length > 0 && route.when !== "gt" && route.when !== "lt") {
    return (
      <select
        aria-label={`Route ${n} answer`}
        value={route.whenValue == null ? "" : String(route.whenValue)}
        onChange={(e) => onChange(e.target.value || null)}
        className={INPUT}
      >
        <option value="">Pick an answer</option>
        {choices.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      aria-label={`Route ${n} answer`}
      type={numeric || route.when === "gt" || route.when === "lt" ? "number" : "text"}
      inputMode={numeric ? "numeric" : undefined}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = e.target.value.trim();
        onChange(v === "" ? null : toAnswer(v, numeric || route.when === "gt" || route.when === "lt"));
      }}
      className={INPUT}
    />
  );
}
