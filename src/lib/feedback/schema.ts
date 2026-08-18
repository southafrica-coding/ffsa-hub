// ============================================================
// Post-event feedback schema — stored in event_feedback_forms.schema
// ============================================================
// A feedback form is an ordered list of sections; each section has a
// title and an ordered list of questions. Unlike the CRM form schema
// (src/lib/forms/schema.ts) there are no contact-column keys, no
// outcome bindings and no consent fields: nothing here writes to the
// CRM. Answers are keyed by question id, which never changes once a
// question is created, so renaming a question keeps its history.
// ============================================================

export type FeedbackFieldType =
  | "short_text"
  | "long_text"
  | "rating" // 1–5, rendered as stars
  | "scale" // numeric range with end labels (default 1–10)
  | "nps" // 0–10 "would you recommend", scored the NPS way
  | "choice" // pick one (radio)
  | "multi_choice" // pick many (checkboxes)
  | "dropdown"
  | "yes_no"
  | "number"
  | "date";

export type FeedbackField = {
  id: string;
  type: FeedbackFieldType;
  label: string;
  helpText?: string | null;
  required: boolean;
  /** choice / multi_choice / dropdown */
  options?: string[];
  /** scale only — inclusive bounds and the words at each end */
  scaleMin?: number;
  scaleMax?: number;
  minLabel?: string | null;
  maxLabel?: string | null;
};

export type FeedbackSection = {
  id: string;
  title: string;
  description?: string | null;
  fields: FeedbackField[];
};

export type FeedbackSchema = {
  version: 1;
  sections: FeedbackSection[];
};

export const FEEDBACK_FIELD_TYPES: {
  value: FeedbackFieldType;
  label: string;
  hint: string;
}[] = [
  { value: "rating", label: "Rating (1–5)", hint: "Stars. Averages on the summary." },
  { value: "scale", label: "Scale", hint: "Numeric range with labelled ends." },
  { value: "nps", label: "Recommend (0–10)", hint: "Scored as an NPS." },
  { value: "long_text", label: "Long text", hint: "Paragraph answer." },
  { value: "short_text", label: "Short text", hint: "One line." },
  { value: "choice", label: "Multiple choice", hint: "Pick one." },
  { value: "multi_choice", label: "Checkboxes", hint: "Pick any number." },
  { value: "dropdown", label: "Dropdown", hint: "Pick one, from a list." },
  { value: "yes_no", label: "Yes / No", hint: "Two options." },
  { value: "number", label: "Number", hint: "Any number." },
  { value: "date", label: "Date", hint: "A calendar date." },
];

export const CHOICE_TYPES: FeedbackFieldType[] = [
  "choice",
  "multi_choice",
  "dropdown",
];

/** Types whose answers are numeric and therefore chartable. */
export const NUMERIC_TYPES: FeedbackFieldType[] = ["rating", "scale", "nps"];

export function isChoiceType(t: FeedbackFieldType): boolean {
  return CHOICE_TYPES.includes(t);
}

export function isNumericType(t: FeedbackFieldType): boolean {
  return NUMERIC_TYPES.includes(t);
}

/** Inclusive bounds for a numeric question, whatever its type. */
export function fieldRange(field: FeedbackField): { min: number; max: number } {
  if (field.type === "rating") return { min: 1, max: 5 };
  if (field.type === "nps") return { min: 0, max: 10 };
  return {
    min: field.scaleMin ?? 1,
    max: field.scaleMax ?? 10,
  };
}

export function newLocalId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `f_${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyFeedbackSchema(): FeedbackSchema {
  return {
    version: 1,
    sections: [
      {
        id: newLocalId(),
        title: "Your feedback",
        description: null,
        fields: [],
      },
    ],
  };
}

export function newFeedbackField(type: FeedbackFieldType): FeedbackField {
  const base: FeedbackField = {
    id: newLocalId(),
    type,
    label: "",
    helpText: null,
    required: false,
  };
  if (isChoiceType(type)) return { ...base, options: ["Option 1", "Option 2"] };
  if (type === "scale")
    return { ...base, scaleMin: 1, scaleMax: 10, minLabel: "Poor", maxLabel: "Excellent" };
  return base;
}

/** Every question across every section, in display order. */
export function allFields(schema: FeedbackSchema): FeedbackField[] {
  return schema.sections.flatMap((s) => s.fields);
}

export function isFeedbackSchema(raw: unknown): raw is FeedbackSchema {
  return (
    !!raw &&
    typeof raw === "object" &&
    "sections" in raw &&
    Array.isArray((raw as FeedbackSchema).sections)
  );
}

export function parseFeedbackSchema(raw: unknown): FeedbackSchema {
  return isFeedbackSchema(raw) ? raw : emptyFeedbackSchema();
}

// ────────────────────────────────────────────────────────────
// The starter template
// ────────────────────────────────────────────────────────────
// Nobody writes a debrief survey from a blank page at 11pm after an
// event, so a new form can be filled with a working one in a click.
// These are the questions that actually change how the next event
// runs: a score you can trend, then the two open questions that
// produce the notes.

export function debriefTemplate(eventTitle: string): FeedbackSchema {
  return {
    version: 1,
    sections: [
      {
        id: newLocalId(),
        title: "How it went",
        description: `Your honest read on ${eventTitle}. It takes about three minutes.`,
        fields: [
          {
            id: newLocalId(),
            type: "rating",
            label: "Overall, how well did the event go?",
            required: true,
            helpText: null,
          },
          {
            id: newLocalId(),
            type: "rating",
            label: "How clear was the communication before the event?",
            required: true,
            helpText: "Did you know where to be, when, and doing what?",
          },
          {
            id: newLocalId(),
            type: "rating",
            label: "How well did the logistics hold up on the day?",
            required: true,
            helpText: "Setup, schedule, equipment, food, transport.",
          },
          {
            id: newLocalId(),
            type: "rating",
            label: "How supported did you feel in your role?",
            required: true,
            helpText: null,
          },
        ],
      },
      {
        id: newLocalId(),
        title: "What to keep, what to change",
        description: null,
        fields: [
          {
            id: newLocalId(),
            type: "long_text",
            label: "What worked so well that we should do it again?",
            required: true,
            helpText: null,
          },
          {
            id: newLocalId(),
            type: "long_text",
            label: "What is the one thing you would change next time?",
            required: true,
            helpText: "One thing, the one that matters most.",
          },
          {
            id: newLocalId(),
            type: "long_text",
            label: "Anything that went wrong that leadership may not know about?",
            required: false,
            helpText: null,
          },
        ],
      },
      {
        id: newLocalId(),
        title: "You and your team",
        description: null,
        fields: [
          {
            id: newLocalId(),
            type: "short_text",
            label: "What role did you serve in?",
            required: false,
            helpText: "e.g. MC, registration desk, worship, setup, follow-up.",
          },
          {
            id: newLocalId(),
            type: "yes_no",
            label: "Would you serve at this event again?",
            required: true,
            helpText: null,
          },
          {
            id: newLocalId(),
            type: "long_text",
            label: "Anyone who deserves to be thanked by name?",
            required: false,
            helpText: null,
          },
        ],
      },
    ],
  };
}

// ────────────────────────────────────────────────────────────
// Validation — shared by the public runtime and the submit route
// ────────────────────────────────────────────────────────────

export type ValidationResult = {
  valid: boolean;
  errors: Record<string, string>;
};

function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

export function validateFeedback(
  schema: FeedbackSchema,
  values: Record<string, unknown>
): ValidationResult {
  const errors: Record<string, string> = {};

  for (const field of allFields(schema)) {
    const v = values[field.id];

    if (isBlank(v)) {
      if (field.required) errors[field.id] = "This question needs an answer.";
      continue;
    }

    if (isNumericType(field.type) || field.type === "number") {
      const n = Number(v);
      if (Number.isNaN(n)) {
        errors[field.id] = "Enter a number.";
        continue;
      }
      if (isNumericType(field.type)) {
        const { min, max } = fieldRange(field);
        if (n < min || n > max) errors[field.id] = `Pick a value between ${min} and ${max}.`;
      }
      continue;
    }

    if (field.type === "choice" || field.type === "dropdown") {
      const opts = field.options ?? [];
      if (opts.length && !opts.includes(String(v))) {
        errors[field.id] = "Pick one of the listed options.";
      }
      continue;
    }

    if (field.type === "multi_choice") {
      const opts = field.options ?? [];
      const picked = Array.isArray(v) ? v : [v];
      if (opts.length && picked.some((p) => !opts.includes(String(p)))) {
        errors[field.id] = "Pick from the listed options.";
      }
      continue;
    }

    if (field.type === "yes_no") {
      if (!["Yes", "No", true, false].includes(v as string | boolean)) {
        errors[field.id] = "Answer Yes or No.";
      }
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/** Human-readable rendering of one stored answer, for tables and CSV. */
export function formatAnswer(
  field: FeedbackField,
  answers: Record<string, unknown>
): string {
  const v = answers[field.id];
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (field.type === "rating") return `${v} / 5`;
  if (field.type === "nps") return `${v} / 10`;
  if (field.type === "scale") {
    const { max } = fieldRange(field);
    return `${v} / ${max}`;
  }
  return String(v);
}
