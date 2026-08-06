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
import {
  HouseholdMembers,
  type HouseholdMember,
  type SelfDefaults,
} from "@/components/profile/household-members";

// Blocking panel for the staff "children" gate. Two states:
//   1. hasChildren == null  → ask "Do you have children?" (Yes / No).
//   2. hasChildren == true & incomplete → force the full details for each
//      child before the Hub unblocks.
// The parent gate (profile-completion-gate) decides which case applies and
// only renders this when the user is actually blocked, so state 2 is shown
// whenever hasChildren is already true.
export function ChildrenGateForm({
  hasChildren,
  members,
  selfDefaults,
}: {
  hasChildren: boolean | null;
  members: HouseholdMember[];
  selfDefaults?: SelfDefaults;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(value: boolean) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/update", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ has_children: value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not save your answer. Please try again.");
        return;
      }
      // Gate re-evaluates: "No" clears it; "Yes" advances to the add step.
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // ── State 1: the yes/no question ─────────────────────────────
  if (hasChildren == null) {
    return (
      <Card className="w-full max-w-md mx-4 shadow-2xl">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Do you have children?</CardTitle>
          <CardDescription>
            We keep each staff member&rsquo;s children on record (passport,
            visa and health-insurance details). Please let us know.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Button
              className="flex-1"
              onClick={() => answer(true)}
              disabled={saving}
            >
              Yes, I have children
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => answer(false)}
              disabled={saving}
            >
              No
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    );
  }

  // ── State 2: must complete each child ────────────────────────
  return (
    <Card className="w-full max-w-2xl mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Add your children</CardTitle>
        <CardDescription>
          Please add each child with their full details — name, date of birth,
          gender, passport, and health insurance (plus visa if they&rsquo;re
          international). You can continue once at least one child is fully
          completed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <HouseholdMembers
          initialMembers={members}
          requireComplete
          defaultRelationship="child"
          selfDefaults={selfDefaults}
        />
      </CardContent>
    </Card>
  );
}
