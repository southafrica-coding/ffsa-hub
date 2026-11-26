import {
  type FormAccessMode,
  type FormField,
  type FormFieldType,
  type FormKind,
  type FormRoute,
  type FormRouteAction,
  type FormRouteWhen,
  numericBounds,
} from "@/lib/forms/schema";

// ============================================================
// Plain words for the builder — field types, routes, access
// ============================================================
// Staff never see the stored codes (write_column, gt, logged_in).
// Every label the builder prints for them comes from here.
// ============================================================

export const FIELD_TYPE_LABELS: { value: FormFieldType; label: string }[] = [
  { value: "text", label: "Short text" },
  { value: "long_text", label: "Long text" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "date", label: "Date" },
  { value: "number", label: "Number" },
  { value: "linear_scale", label: "Linear scale" },
  { value: "stepper", label: "Counter (− and +)" },
  { value: "yes_no", label: "Yes / No" },
  { value: "dropdown", label: "Dropdown" },
  { value: "multiselect", label: "Checkboxes (pick several)" },
  { value: "radio", label: "Radio buttons" },
  { value: "checkbox", label: "Single checkbox" },
  { value: "outcome", label: "Outcome response" },
  { value: "consent", label: "Consent (POPIA)" },
];

export function fieldTypeLabel(type: FormFieldType): string {
  return FIELD_TYPE_LABELS.find((t) => t.value === type)?.label ?? type;
}

export const CHOICE_TYPES: FormFieldType[] = ["dropdown", "multiselect", "radio"];
export const NUMERIC_TYPES: FormFieldType[] = ["linear_scale", "stepper"];

/** One line under a question in the list: type, bounds, required. */
export function describeField(field: FormField): string {
  const parts: string[] = [fieldTypeLabel(field.type)];
  if (field.type === "linear_scale" || field.type === "stepper") {
    const { min, max } = numericBounds(field);
    parts.push(max != null ? `${min} to ${max}` : `from ${min}`);
    if (field.minLabel || field.maxLabel) {
      parts.push(`${field.minLabel || min} → ${field.maxLabel || max || "…"}`);
    }
  }
  if (CHOICE_TYPES.includes(field.type) && field.options?.length) {
    parts.push(`${field.options.length} option${field.options.length === 1 ? "" : "s"}`);
  }
  parts.push(field.required ? "required" : "optional");
  return parts.join(" · ");
}

export const ROUTE_ACTION_LABELS: Record<FormRouteAction, string> = {
  store: "Keep with the response",
  write_column: "Write to a column",
  create_or_update_contact: "Create or update a contact",
  attach: "Attach to what the form is about",
  open_followup: "Open a follow-up",
  care_board: "Put a card on the Care board",
  slack: "Message someone in Slack",
};

/** What the target box asks for, per action. Null = no target. */
export const ROUTE_TARGET_PROMPTS: Record<FormRouteAction, string | null> = {
  store: null,
  write_column: "Column, e.g. leader_score",
  create_or_update_contact: "Contact field",
  attach: null,
  open_followup: "Who follows up, e.g. pastor",
  care_board: "Care type, e.g. prayer",
  slack: "Who, e.g. house coach",
};

export const ROUTE_WHEN_LABELS: Record<FormRouteWhen, string> = {
  always: "Every time it is answered",
  equals: "When the answer is",
  not_equals: "When the answer is not",
  gt: "When the answer is more than",
  lt: "When the answer is less than",
  includes: "When the picks include",
  in: "When the answer is one of",
};

function whenValueText(route: FormRoute): string {
  const v = route.whenValue;
  if (Array.isArray(v)) return v.join(" or ");
  return v == null ? "" : String(v);
}

/** "When the answer is 1 or 2" — the first line of a route card. */
export function describeRouteWhen(route: FormRoute): string {
  if (route.when === "always") return ROUTE_WHEN_LABELS.always;
  const value = whenValueText(route);
  return value ? `${ROUTE_WHEN_LABELS[route.when]} ${value}` : ROUTE_WHEN_LABELS[route.when];
}

/** "Message someone in Slack · house coach" — the second line. */
export function describeRouteThen(route: FormRoute): string {
  const target = route.target?.trim();
  return target ? `${ROUTE_ACTION_LABELS[route.action]} · ${target}` : ROUTE_ACTION_LABELS[route.action];
}

/** Short chip text for the question list. */
export function routeChip(route: FormRoute): string {
  const then = describeRouteThen(route);
  if (route.when === "always") return then;
  const value = whenValueText(route);
  return value ? `${then} if ${ROUTE_WHEN_SHORT[route.when]} ${value}` : then;
}

const ROUTE_WHEN_SHORT: Record<FormRouteWhen, string> = {
  always: "",
  equals: "=",
  not_equals: "≠",
  gt: ">",
  lt: "<",
  includes: "has",
  in: "is",
};

export const ACCESS_MODE_LABELS: Record<FormAccessMode, string> = {
  public: "Anyone with the link",
  logged_in: "Hub login needed",
  token: "Personal link only",
};

export const KIND_LABELS: Record<FormKind, string> = {
  generic: "Form",
  event: "Event",
  department: "Department",
  missio_weekly_feedback: "Missio weekly",
};

export { accessModeOf } from "@/lib/forms/access";

/** kind as stored; event forms predate the column, so event_id wins. */
export function kindOf(raw: unknown, eventId: string | null | undefined): FormKind {
  if (eventId) return "event";
  return raw === "department" || raw === "missio_weekly_feedback" || raw === "event"
    ? raw
    : "generic";
}
