"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { type FieldConfig, isExpiryDatePast } from "@/lib/users/profile-fields";
import {
  FieldControl,
  OTHER_SENTINEL,
  seedOtherActive,
} from "@/components/profile/field-control";

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
    () => seedOtherActive(fields, defaults ?? {})
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
    // Cap the card to the viewport and lay it out as header / scrollable body /
    // pinned footer, so a long field list never pushes the title or the
    // Continue button off-screen (the reason it looked "cut off").
    <Card className="w-full max-w-2xl shadow-2xl flex flex-col max-h-[calc(100dvh-2rem)]">
      <CardHeader className="text-center shrink-0">
        <CardTitle className="text-xl">{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto">
        {/* Two columns so the field list fills the card's width instead of a
            tall single strip that needs scrolling. */}
        <form
          id="profile-completion-form"
          onSubmit={handleSubmit}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          {fields.map((f) => (
            <FieldControl
              key={f.field}
              field={f}
              idPrefix="gate"
              value={values[f.field] ?? ""}
              otherActive={!!otherActive[f.field]}
              onValueChange={(v) => setValue(f.field, v)}
              onOtherActiveChange={(active) =>
                setOtherActive((prev) => ({ ...prev, [f.field]: active }))
              }
            />
          ))}
        </form>
      </CardContent>
      <div className="shrink-0 space-y-2 border-t p-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          type="submit"
          form="profile-completion-form"
          className="w-full"
          disabled={loading}
        >
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
      </div>
    </Card>
  );
}
