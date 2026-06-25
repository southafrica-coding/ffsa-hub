"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { ProfileCompletionForm } from "./profile-completion-form";
import { HEALTH_INSURANCE_FIELDS } from "@/lib/users/profile-fields";

// Shown by the gate when a user's 6-monthly health-insurance confirmation
// has lapsed. One click ("Yes, still up to date") re-stamps the confirmation
// server-side and clears the block; "No" reveals the provider/policy form so
// they can correct the details (saving there also re-stamps the
// confirmation). Replaces the old expiry-date renewal flow.
export function InsuranceReconfirmPanel({
  providerLabel,
  policyNumber,
  defaults,
}: {
  providerLabel: string;
  policyNumber: string;
  // Pre-fill for the "No, update it" path (raw provider value + policy number).
  defaults: Record<string, string>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/confirm-insurance", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Couldn't confirm. Please try again.");
        return;
      }
      // The gate re-checks on refresh and lets them through.
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // "No, update it" → the standard insurance form (provider + policy). Saving
  // it stamps the confirmation server-side, so the gate clears afterwards.
  if (editing) {
    return (
      <ProfileCompletionForm
        fields={HEALTH_INSURANCE_FIELDS}
        reason="insurance_confirm"
        defaults={defaults}
      />
    );
  }

  return (
    <Card className="w-full max-w-md mx-4 shadow-2xl">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
          <ShieldCheck className="h-5 w-5 text-primary" />
        </div>
        <CardTitle className="text-xl">
          Is your health insurance still up to date?
        </CardTitle>
        <CardDescription>
          We check in every 6 months to keep your cover details current.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border p-3 text-sm">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            On file
          </div>
          <div className="mt-1 font-medium">{providerLabel || "—"}</div>
          {policyNumber && (
            <div className="text-muted-foreground">Policy {policyNumber}</div>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button className="w-full" disabled={loading} onClick={confirm}>
          {loading ? "Confirming…" : "Yes, it's still up to date"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={loading}
          onClick={() => setEditing(true)}
        >
          No, I need to update it
        </Button>
      </CardContent>
    </Card>
  );
}
