"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { type FieldConfig, isExpiryDatePast } from "@/lib/users/profile-fields";

const OTHER_SENTINEL = "__other__";

// Why the form is on screen — drives the heading and copy. The gate
// passes "incomplete" / "insurance_expired" (blocking); the expiry
// banner passes "insurance_expiring" (dismissible).
export type ProfileFormReason =
  | "incomplete"
  | "insurance_expired"
  | "insurance_expiring";

const COPY: Record<ProfileFormReason, { title: string; description: string }> = {
  incomplete: {
    title: "Complete Your Profile",
    description: "Please fill in the following information to continue.",
  },
  insurance_expired: {
    title: "Update Your Health Insurance",
    description:
      "Your health insurance is no longer valid. Please enter your current policy details to keep using the Hub.",
  },
  insurance_expiring: {
    title: "Update Your Health Insurance",
    description:
      "Your health insurance is about to expire. Update your current policy details below.",
  },
};

export function ProfileCompletionForm({
  fields,
  reason = "incomplete",
  defaults,
  onDismiss,
}: {
  fields: FieldConfig[];
  reason?: ProfileFormReason;
  // Pre-filled values (e.g. existing provider / policy number on renewal).
  defaults?: Record<string, string>;
  // When provided, the form is non-blocking and shows a "Maybe later" exit.
  onDismiss?: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...(defaults ?? {}),
  }));
  // For `select-with-other`: tracks whether the user has chosen "Other".
  // Stored separately from `values` so we know to render the follow-up
  // text input even before they've typed anything. Seeded from defaults so
  // a pre-filled off-list value (a custom provider) shows in the text box.
  const [otherActive, setOtherActive] = useState<Record<string, boolean>>(
    () => {
      const init: Record<string, boolean> = {};
      for (const f of fields) {
        if (f.type === "select-with-other" && f.options && defaults?.[f.field]) {
          const known = new Set(f.options.map((o) => o.value));
          if (!known.has(defaults[f.field])) init[f.field] = true;
        }
      }
      return init;
    }
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = COPY[reason];

  function setValue(field: string, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validate all fields are filled — but for select-with-other we
    // need the follow-up text, not the sentinel.
    for (const f of fields) {
      const v = values[f.field]?.trim();
      if (!v || v === OTHER_SENTINEL) {
        setError(`Please fill in: ${f.label}`);
        return;
      }
      // A renewed policy must expire in the future — otherwise the gate
      // would just re-block them on the next render.
      if (f.field === "health_insurance_expiry_date" && isExpiryDatePast(v)) {
        setError(
          "Your health insurance expiry date can't be in the past. Please enter the date your current policy expires."
        );
        return;
      }
    }

    setLoading(true);

    try {
      const res = await fetch("/api/profile/update", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to update profile");
        return;
      }

      // Refresh the page — the gate/banner will re-check and let them through
      router.refresh();
      onDismiss?.();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {fields.map((f) => (
            <FieldControl
              key={f.field}
              field={f}
              value={values[f.field] ?? ""}
              otherActive={!!otherActive[f.field]}
              onValueChange={(v) => setValue(f.field, v)}
              onOtherActiveChange={(active) =>
                setOtherActive((prev) => ({ ...prev, [f.field]: active }))
              }
            />
          ))}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Saving..." : "Continue"}
          </Button>

          {onDismiss && (
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              disabled={loading}
              onClick={onDismiss}
            >
              Maybe later
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function FieldControl({
  field,
  value,
  otherActive,
  onValueChange,
  onOtherActiveChange,
}: {
  field: FieldConfig;
  value: string;
  otherActive: boolean;
  onValueChange: (v: string) => void;
  onOtherActiveChange: (active: boolean) => void;
}) {
  const id = `gate-${field.field}`;

  if (field.type === "phone") {
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{field.label}</Label>
        <PhoneInput id={id} value={value} onChange={onValueChange} required />
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
          required
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
    // The dropdown drives the select-display. When the user picks
    // "Other", we flip `otherActive` and reveal the follow-up input.
    // The follow-up input writes directly into `value` so saving Just
    // Works without per-field branching.
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
          required
        >
          <option value="">Select...</option>
          {field.options.map((opt) => (
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
            required
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
        required
      />
    </div>
  );
}
