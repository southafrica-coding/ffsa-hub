// ============================================================
// Multi-step form schema — stored in forms.schema (jsonb)
// ============================================================
// A form is an ordered list of steps; each step has a title and
// an ordered list of fields. v1 is linear (no branching).
// ============================================================

export type FormFieldType =
  | "text"
  | "long_text"
  | "email"
  | "phone"
  | "date"
  | "number"
  | "dropdown"
  | "multiselect"
  | "radio"
  | "checkbox"
  | "yes_no"
  | "outcome"
  | "consent"
  | "linear_scale" // 1–5 style score; bounds in min/max
  | "stepper"; // whole-number counter; bounds in min/max

export type FormField = {
  id: string; // local uuid, stable within the schema
  type: FormFieldType;
  label: string;
  /**
   * Where the answer goes. A known contact column (see CONTACT_FIELD_KEYS)
   * maps into the contact record; anything else is a custom key and the
   * answer is kept in form_submissions.raw_data only.
   */
  key: string;
  required: boolean;
  options?: string[]; // dropdown / multiselect / radio
  outcomeId?: string | null; // outcome fields — binds to an event_outcome
  agreementVersion?: string | null; // consent fields
  helpText?: string | null;
  /**
   * Conditional visibility. When set, this field is only shown if the
   * referenced parent field's current answer equals `showWhenValue`.
   * Chains are allowed — a child can itself be a parent. See
   * `isFieldVisible` for the resolution rules.
   */
  parentFieldId?: string | null;
  showWhenValue?: string | null;
  /**
   * Bounds for linear_scale and stepper. A linear_scale defaults to 1–5;
   * a stepper defaults to 0 with no top. A stepper may use its top as
   * "more than": e.g. max 6 with maxLabel "More than 5".
   */
  min?: number | null;
  max?: number | null;
  minLabel?: string | null;
  maxLabel?: string | null;
  /**
   * What happens to the answer after it is saved. Each route fires when
   * its rule matches (see `routeMatches`). F1 only describes and matches
   * routes; route-runner.ts runs them after a submission is saved.
   */
  routes?: FormRoute[];
};

// ────────────────────────────────────────────────────────────
// Routes — where an answer goes once the form is sent
// ────────────────────────────────────────────────────────────

export const FORM_ROUTE_ACTIONS = [
  "store", // keep it in form_submissions.raw_data (always true; explicit for clarity)
  "write_column", // copy into a column of the subject's table; target = column
  "create_or_update_contact", // upsert a contact; target = contact column
  "attach", // attach to the subject (house, event, department)
  "open_followup", // open a follow-up for a pastor or coach; target = queue
  "care_board", // put a card on the Missio Care board; target = care type
  "slack", // DM someone; target = who. Off unless HUB_FORMS_SLACK_ENABLED (flags.ts)
] as const;

export type FormRouteAction = (typeof FORM_ROUTE_ACTIONS)[number];

export const FORM_ROUTE_WHENS = [
  "always", // whenever the field is visible and answered
  "equals",
  "not_equals",
  "gt",
  "lt",
  "includes", // a multi-pick answer contains whenValue
  "in", // the answer is one of whenValue (a list)
] as const;

export type FormRouteWhen = (typeof FORM_ROUTE_WHENS)[number];

export type FormRoute = {
  action: FormRouteAction;
  target?: string | null;
  when: FormRouteWhen;
  /** Scalar for equals/not_equals/gt/lt/includes, a list for `in`. */
  whenValue?: string | number | Array<string | number> | null;
};

/** Actions that mean nothing without a target. */
const ROUTE_ACTIONS_NEEDING_TARGET: FormRouteAction[] = [
  "write_column",
  "create_or_update_contact",
  "slack",
];

/**
 * Field types whose answer can drive a conditional child. Only choice-style
 * answers produce a single discrete value we can match against. Boolean
 * fields (checkbox / outcome / consent) collapse to a single "checked"
 * rule.
 */
export const PARENT_ELIGIBLE_TYPES: FormFieldType[] = [
  "yes_no",
  "radio",
  "dropdown",
  "checkbox",
  "outcome",
  "consent",
];

/** Parent types whose answer is a boolean (true when checked). */
export const BOOLEAN_PARENT_TYPES: FormFieldType[] = [
  "checkbox",
  "outcome",
  "consent",
];

export function isParentEligible(field: Pick<FormField, "type">): boolean {
  return PARENT_ELIGIBLE_TYPES.includes(field.type);
}

export function isBooleanParentType(type: FormFieldType): boolean {
  return BOOLEAN_PARENT_TYPES.includes(type);
}

/**
 * The set of values a parent of this type can produce, used to populate
 * the "Show when answer is…" picker in the builder. Boolean parents have
 * the single sentinel "true" (checked).
 */
export function parentValueChoices(
  field: Pick<FormField, "type" | "options">
): string[] {
  switch (field.type) {
    case "yes_no":
      return ["Yes", "No"];
    case "radio":
    case "dropdown":
      return field.options ?? [];
    case "checkbox":
    case "outcome":
    case "consent":
      return ["true"];
    default:
      return [];
  }
}

export type FormStep = {
  id: string;
  title: string;
  fields: FormField[];
};

export type FormBranding = {
  logoUrl?: string | null;
  accentColor?: string | null; // hex, drives buttons + progress bar
};

// ────────────────────────────────────────────────────────────
// Form kinds — mirror the CHECKs on public.forms (migration 390)
// ────────────────────────────────────────────────────────────

export const FORM_KINDS = ["generic", "event", "department", "missio_weekly_feedback"] as const;
export type FormKind = (typeof FORM_KINDS)[number];

export const FORM_ACCESS_MODES = ["public", "logged_in", "token"] as const;
export type FormAccessMode = (typeof FORM_ACCESS_MODES)[number];

export const FORM_SUBJECT_TYPES = ["house", "contact", "department", "event", "none"] as const;
export type FormSubjectType = (typeof FORM_SUBJECT_TYPES)[number];

export type FormSchema = {
  version: 1;
  branding: FormBranding;
  steps: FormStep[];
  thankYou: { heading: string; message: string };
};

// Contact columns a field key may map into. Anything else = custom.
export const CONTACT_FIELD_KEYS = [
  "first_name",
  "last_name",
  "preferred_name",
  "email",
  "phone",
  "date_of_birth",
  "gender",
  "marital_status",
  "nationality",
  "preferred_language",
  "city",
  "province",
  "country",
  "postal_code",
  "address_line_1",
  "address_line_2",
] as const;

export type ContactFieldKey = (typeof CONTACT_FIELD_KEYS)[number];

export function isContactFieldKey(key: string): key is ContactFieldKey {
  return (CONTACT_FIELD_KEYS as readonly string[]).includes(key);
}

let idCounter = 0;
export function newLocalId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

/**
 * The data key a field's answer is stored under. Contact-mapped fields
 * use their contact column key; custom fields fall back to the field id.
 * Runtime, validator, and submit handler all use this so keys line up.
 */
export function fieldKey(field: Pick<FormField, "key" | "id">): string {
  return field.key && field.key.trim() ? field.key.trim() : field.id;
}

/**
 * Flatten every field in the schema into a single id->field lookup. Used
 * by both runtime and validator to walk parent chains.
 */
export function buildFieldsById(schema: FormSchema): Map<string, FormField> {
  const m = new Map<string, FormField>();
  for (const step of schema.steps) {
    for (const f of step.fields) m.set(f.id, f);
  }
  return m;
}

/**
 * Returns true when `field` should be visible given current answer values.
 * Walks the parent chain — every ancestor must be answered with its
 * `showWhenValue` for the descendant to render. Missing parents or cycles
 * resolve to "hidden" so a broken rule never crashes the form.
 */
export function isFieldVisible(
  field: FormField,
  fieldsById: Map<string, FormField>,
  values: Record<string, unknown>
): boolean {
  let current: FormField | undefined = field;
  const seen = new Set<string>();
  while (current?.parentFieldId) {
    if (seen.has(current.id)) return false;
    seen.add(current.id);
    const parent = fieldsById.get(current.parentFieldId);
    if (!parent) return false;
    const expected = current.showWhenValue ?? "";
    const rawParent = values[fieldKey(parent)];
    const actual = isBooleanParentType(parent.type)
      ? rawParent === true
        ? "true"
        : ""
      : typeof rawParent === "string"
      ? rawParent
      : "";
    if (actual !== expected) return false;
    current = parent;
  }
  return true;
}

export function emptyFormSchema(): FormSchema {
  return {
    version: 1,
    branding: { logoUrl: null, accentColor: "#1e40af" },
    steps: [
      {
        id: newLocalId("step"),
        title: "Get started",
        fields: [
          {
            id: newLocalId("field"),
            type: "text",
            label: "First Name",
            key: "first_name",
            required: true,
          },
          {
            id: newLocalId("field"),
            type: "text",
            label: "Last Name",
            key: "last_name",
            required: false,
          },
          {
            id: newLocalId("field"),
            type: "email",
            label: "Email",
            key: "email",
            required: true,
          },
          {
            id: newLocalId("field"),
            type: "phone",
            label: "Mobile Phone Number",
            key: "phone",
            required: false,
          },
        ],
      },
    ],
    thankYou: {
      heading: "Thank you!",
      message: "Your response has been recorded.",
    },
  };
}

// ────────────────────────────────────────────────────────────
// Validation — used by the public submit handler
// ────────────────────────────────────────────────────────────

export type ValidationResult = { valid: boolean; errors: Record<string, string> };

/** Default bounds for the numeric field types. */
export function numericBounds(
  field: Pick<FormField, "type" | "min" | "max">
): { min: number; max: number | null } {
  if (field.type === "linear_scale") {
    return { min: field.min ?? 1, max: field.max ?? 5 };
  }
  return { min: field.min ?? 0, max: field.max ?? null };
}

/** A whole number from a form answer (number or numeric string), else null. */
function toWholeNumber(raw: unknown): number | null {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
      ? Number(raw.trim())
      : NaN;
  return Number.isInteger(n) ? n : null;
}

export function validateSubmission(
  schema: FormSchema,
  data: Record<string, unknown>,
  options: {
    /**
     * Every form so far feeds the contact directory, so it must collect an
     * email or phone. Forms that are not about a contact (the weekly house
     * feedback) pass false.
     */
    requireContactField?: boolean;
  } = {}
): ValidationResult {
  const errors: Record<string, string> = {};
  const fieldsById = buildFieldsById(schema);

  for (const step of schema.steps) {
    for (const field of step.fields) {
      // Conditional fields whose parent rule isn't met are treated as
      // not-present — neither required nor type-checked.
      if (!isFieldVisible(field, fieldsById, data)) continue;
      const k = fieldKey(field);
      const raw = data[k];
      const isEmpty =
        raw == null ||
        raw === "" ||
        (Array.isArray(raw) && raw.length === 0) ||
        (field.type === "checkbox" && raw === false) ||
        (field.type === "consent" && raw !== true);

      if (field.required && isEmpty) {
        errors[k] = `${field.label} is required`;
        continue;
      }
      if (isEmpty) continue;

      if (field.type === "email" && typeof raw === "string") {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim())) {
          errors[k] = "Enter a valid email address";
        }
      }
      if (field.type === "number" && typeof raw === "string" && raw.trim() !== "") {
        if (Number.isNaN(Number(raw))) {
          errors[k] = "Enter a number";
        }
      }
      if (field.type === "linear_scale" || field.type === "stepper") {
        const n = toWholeNumber(raw);
        const { min, max } = numericBounds(field);
        if (n == null) {
          errors[k] = "Enter a whole number";
        } else if (n < min || (max != null && n > max)) {
          errors[k] =
            max != null ? `Pick a number from ${min} to ${max}` : `Enter ${min} or more`;
        }
      }
    }
  }

  // A form must collect at least one of email / phone for dedup.
  const keys = schema.steps.flatMap((s) => s.fields.map((f) => f.key));
  if (options.requireContactField !== false && !keys.includes("email") && !keys.includes("phone")) {
    errors._form = "Form must collect an email or phone field";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// ────────────────────────────────────────────────────────────
// Schema checks — used by the builder before a form is saved
// ────────────────────────────────────────────────────────────

/**
 * Problems with the form definition itself (not an answer): bad bounds on
 * a scale or stepper, and route rules that could never run. Keys are
 * field ids; an empty object means the schema is fine.
 */
export function validateFormSchema(schema: FormSchema): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const step of schema.steps) {
    for (const field of step.fields) {
      const problem = fieldSchemaProblem(field);
      if (problem) errors[field.id] = problem;
    }
  }
  return errors;
}

function fieldSchemaProblem(field: FormField): string | null {
  if (field.type === "linear_scale" || field.type === "stepper") {
    const { min, max } = numericBounds(field);
    if (!Number.isInteger(min)) return "The lowest value must be a whole number";
    if (max != null && !Number.isInteger(max)) return "The highest value must be a whole number";
    if (max != null && max <= min) return "The highest value must be above the lowest";
    if (field.type === "linear_scale" && max != null && max - min > 10) {
      return "A scale can have at most 11 points";
    }
  }
  for (const route of field.routes ?? []) {
    const problem = routeProblem(route);
    if (problem) return problem;
  }
  return null;
}

function routeProblem(route: FormRoute): string | null {
  if (!(FORM_ROUTE_ACTIONS as readonly string[]).includes(route.action)) {
    return `Unknown route action "${route.action}"`;
  }
  if (!(FORM_ROUTE_WHENS as readonly string[]).includes(route.when)) {
    return `Unknown route rule "${route.when}"`;
  }
  if (ROUTE_ACTIONS_NEEDING_TARGET.includes(route.action) && !route.target?.trim()) {
    return `A ${route.action} route needs a target`;
  }
  const v = route.whenValue;
  switch (route.when) {
    case "always":
      return null;
    case "in":
      return Array.isArray(v) && v.length > 0 ? null : "An \"in\" rule needs a list of values";
    case "gt":
    case "lt":
      return typeof toNumber(v) === "number" ? null : `A "${route.when}" rule needs a number`;
    default:
      return v == null || Array.isArray(v) || String(v) === ""
        ? `A "${route.when}" rule needs a value`
        : null;
  }
}

// ────────────────────────────────────────────────────────────
// Route matching — pure; route-runner.ts acts on it
// ────────────────────────────────────────────────────────────

function toNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isAnswered(value: unknown): boolean {
  return !(
    value == null ||
    value === "" ||
    value === false ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** Answers compare as text, so "3" and 3 are the same answer. */
function sameAnswer(a: unknown, b: unknown): boolean {
  return a != null && b != null && String(a) === String(b);
}

/**
 * Does this route fire for this answer? An unanswered field fires
 * nothing, not even `always`. Numbers may arrive as numbers or numeric
 * strings. Multi-pick answers (arrays) match `includes` and `in` by
 * membership; `equals` on a multi-pick never matches.
 */
export function routeMatches(route: FormRoute, value: unknown): boolean {
  if (!isAnswered(value)) return false;
  const expected = route.whenValue;
  switch (route.when) {
    case "always":
      return true;
    case "equals":
      return !Array.isArray(value) && sameAnswer(value, expected);
    case "not_equals":
      return !Array.isArray(value) && expected != null && !sameAnswer(value, expected);
    case "gt":
    case "lt": {
      const n = toNumber(value);
      const limit = toNumber(expected);
      if (n == null || limit == null) return false;
      return route.when === "gt" ? n > limit : n < limit;
    }
    case "includes":
      return Array.isArray(value)
        ? value.some((v) => sameAnswer(v, expected))
        : sameAnswer(value, expected);
    case "in": {
      if (!Array.isArray(expected)) return false;
      const answers = Array.isArray(value) ? value : [value];
      return answers.some((a) => expected.some((e) => sameAnswer(a, e)));
    }
    default:
      return false;
  }
}

export type FiredRoute = {
  field: FormField;
  route: FormRoute;
  value: unknown;
};

/**
 * Every route that fires for a submission, in schema order. Fields hidden
 * by `showWhen` fire nothing (their answers are not part of the form).
 */
export function firedRoutes(
  schema: FormSchema,
  data: Record<string, unknown>
): FiredRoute[] {
  const fieldsById = buildFieldsById(schema);
  const fired: FiredRoute[] = [];
  for (const step of schema.steps) {
    for (const field of step.fields) {
      if (!field.routes?.length) continue;
      if (!isFieldVisible(field, fieldsById, data)) continue;
      const value = data[fieldKey(field)];
      for (const route of field.routes) {
        if (routeMatches(route, value)) fired.push({ field, route, value });
      }
    }
  }
  return fired;
}
