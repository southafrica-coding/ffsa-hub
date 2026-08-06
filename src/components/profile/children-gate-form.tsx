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

// Blocking family gate for staff. A short two-step flow:
//
//   Step 1 — Spouse (optional): "Do you have a spouse?" Add them (name +
//            email) so their account can be linked later. Never blocks.
//   Step 2 — Children (mandatory): "Do you have children?" If yes, every
//            child must be fully completed before the Hub unblocks; if no,
//            the gate clears. A spouse alone is always allowed through — the
//            complete-child requirement only applies when they actually have
//            children.
//
// `hasChildren` (users.has_children) drives step 2's mandatory logic. The
// parent gate only mounts this while the user is still blocked, so once
// hasChildren is true we open directly on the children step.
type Step = "spouse" | "children-ask" | "children-add";

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
  // If they've already said "yes" to children (record incomplete), open on the
  // add step; otherwise start at the spouse step.
  const [step, setStep] = useState<Step>(
    hasChildren === true ? "children-add" : "spouse"
  );

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
      // Advance locally too: router.refresh() re-renders but does NOT remount
      // this component, so the `step` state wouldn't otherwise react to the new
      // hasChildren value. "Yes" → add step; "No" clears the gate on refresh.
      if (value) setStep("children-add");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // ── Step 1: Spouse (optional) ────────────────────────────────
  if (step === "spouse") {
    return (
      <Card className="w-full max-w-2xl shadow-2xl">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Do you have a spouse?</CardTitle>
          <CardDescription>
            If so, add them below — we just need their name and email so their
            own account can be linked later. This step is optional.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <HouseholdMembers
            initialMembers={members}
            defaultRelationship="spouse"
            refreshRouterOnChange={false}
          />
          <Button className="w-full" onClick={() => setStep("children-ask")}>
            Continue
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Step 2a: the children yes/no question ────────────────────
  if (step === "children-ask") {
    return (
      <Card className="w-full max-w-md shadow-2xl">
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
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => setStep("spouse")}
            disabled={saving}
          >
            ← Back
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Step 2b: must complete each child ────────────────────────
  return (
    <Card className="w-full max-w-2xl shadow-2xl">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Add your children</CardTitle>
        <CardDescription>
          Please add each child with their full details — name, date of birth,
          gender, passport, and health insurance (plus visa if they&rsquo;re
          international). You can continue once at least one child is fully
          completed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <HouseholdMembers
          initialMembers={members}
          requireComplete
          defaultRelationship="child"
          selfDefaults={selfDefaults}
        />
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => setStep("children-ask")}
          disabled={saving}
        >
          ← Back
        </Button>
      </CardContent>
    </Card>
  );
}
