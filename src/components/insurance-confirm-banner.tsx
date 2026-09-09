"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProfileCompletionForm } from "./profile-completion-form";
import { HEALTH_INSURANCE_FIELDS } from "@/lib/users/profile-fields";

// Non-blocking annual check-in for an OPEN-ENDED medical scheme. Such a
// policy never lapses on its own, so nothing else would ever prompt
// someone who has quietly switched schemes — once a year we ask.
//
// "Yes, still active" is a single POST that restarts the clock;
// "My policy changed" opens the same insurance form the expiry banner
// uses. Only after a long grace period does the gate step in
// (getInsuranceConfirmation → "blocking").
export function InsuranceConfirmBanner({
  provider,
  dueOn,
  daysUntilDue,
  defaults,
}: {
  provider: string;
  dueOn: string | null;
  daysUntilDue: number | null;
  defaults: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Dismissed for this render only — it comes back on the next page load,
  // matching how the expiry banner nags.
  const [hidden, setHidden] = useState(false);

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/insurance-confirm", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Couldn't save that. Please try again.");
        return;
      }
      setHidden(true);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (hidden) return null;

  const when =
    daysUntilDue === null
      ? ""
      : daysUntilDue > 0
        ? ` (due in ${daysUntilDue} ${daysUntilDue === 1 ? "day" : "days"})`
        : dueOn
          ? ` (due ${formatDate(dueOn)})`
          : "";

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
          <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Is your health insurance still with {provider || "your medical scheme"}?
            Your policy doesn&apos;t expire, so we check once a year{when}.
            {error && <span className="block text-destructive">{error}</span>}
          </span>
        </div>
        <div className="flex shrink-0 gap-2 self-start sm:self-auto">
          <Button size="sm" onClick={confirm} disabled={saving}>
            {saving ? "Saving..." : "Yes, still active"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={() => setOpen(true)}
          >
            My policy changed
          </Button>
        </div>
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
