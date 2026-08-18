"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProfileCompletionForm } from "./profile-completion-form";
import { HEALTH_INSURANCE_FIELDS } from "@/lib/users/profile-fields";

// Non-blocking heads-up shown across the Hub for the ~60 days before a
// user's health insurance lapses. "Update now" opens the same insurance
// form the gate uses; once they save a future expiry the server re-renders
// and the banner disappears on its own.
export function InsuranceExpiryBanner({
  expiryDate,
  daysLeft,
  defaults,
}: {
  expiryDate: string;
  daysLeft: number;
  defaults: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);

  const when =
    daysLeft <= 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`;

  return (
    <>
      <div
        className="mb-6 flex flex-col gap-2 border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        style={{
          borderColor: "var(--amber-border)",
          background: "var(--yellow-dim)",
          color: "var(--amber)",
        }}
      >
        <div className="flex items-start gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Your health insurance expires {when} ({formatDate(expiryDate)}).
            Please update your policy details to avoid losing access to the Hub.
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 self-start sm:self-auto"
          onClick={() => setOpen(true)}
        >
          Update now
        </Button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <ProfileCompletionForm
            fields={HEALTH_INSURANCE_FIELDS}
            reason="insurance_expiring"
            defaults={defaults}
            onDismiss={() => setOpen(false)}
          />
        </div>
      )}
    </>
  );
}

function formatDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
