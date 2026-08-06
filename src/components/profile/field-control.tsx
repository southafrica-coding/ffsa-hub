"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { type FieldConfig } from "@/lib/users/profile-fields";

// Sentinel a `select-with-other` dropdown holds while the user is typing a
// custom value into the revealed follow-up input.
export const OTHER_SENTINEL = "__other__";

// Shared input renderer for every profile FieldConfig type. Used by both the
// blocking ProfileCompletionForm and the editable profile page so the two
// surfaces can never drift on how a field is collected. `otherActive` /
// `onOtherActiveChange` are lifted to the parent so it controls whether the
// `select-with-other` follow-up text box is showing.
export function FieldControl({
  field,
  value,
  otherActive,
  onValueChange,
  onOtherActiveChange,
  required = true,
  idPrefix = "field",
}: {
  field: FieldConfig;
  value: string;
  otherActive: boolean;
  onValueChange: (v: string) => void;
  onOtherActiveChange: (active: boolean) => void;
  required?: boolean;
  idPrefix?: string;
}) {
  const id = `${idPrefix}-${field.field}`;

  if (field.type === "phone") {
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{field.label}</Label>
        <PhoneInput
          id={id}
          value={value}
          onChange={onValueChange}
          required={required}
        />
      </div>
    );
  }

  if (field.type === "select" && field.options) {
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{field.label}</Label>
        <select
          id={id}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          required={required}
        >
          <option value="">Select...</option>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === "select-with-other" && field.options) {
    // The dropdown drives the select-display. When the user picks "Other",
    // we flip `otherActive` and reveal the follow-up input. The follow-up
    // input writes directly into `value` so saving Just Works without
    // per-field branching.
    const selectValue = otherActive ? OTHER_SENTINEL : value;
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{field.label}</Label>
        <select
          id={id}
          value={selectValue}
          onChange={(e) => {
            if (e.target.value === OTHER_SENTINEL) {
              onOtherActiveChange(true);
              onValueChange("");
            } else {
              onOtherActiveChange(false);
              onValueChange(e.target.value);
            }
          }}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          required={required}
        >
          <option value="">Select...</option>
          {field.options
            // Drop any list-provided "other" entry so we don't render a
            // second "Other" alongside the sentinel option below.
            .filter((opt) => opt.value !== "other")
            .map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          <option value={OTHER_SENTINEL}>Other (enter manually)</option>
        </select>
        {otherActive && (
          <Input
            placeholder={`Enter ${field.label.toLowerCase()}`}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            required={required}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{field.label}</Label>
      <Input
        id={id}
        type={
          field.type === "date" ? "date" : field.type === "tel" ? "tel" : "text"
        }
        placeholder={field.placeholder}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        required={required}
      />
    </div>
  );
}

// Seed which `select-with-other` fields should open in "Other" mode: a
// stored value that isn't one of the curated options is a custom entry, so
// the follow-up text box must show. Shared so the gate form and the editable
// page seed identically.
export function seedOtherActive(
  fields: FieldConfig[],
  values: Record<string, string>
): Record<string, boolean> {
  const init: Record<string, boolean> = {};
  for (const f of fields) {
    if (f.type === "select-with-other" && f.options && values[f.field]) {
      const known = new Set(f.options.map((o) => o.value));
      if (!known.has(values[f.field])) init[f.field] = true;
    }
  }
  return init;
}
