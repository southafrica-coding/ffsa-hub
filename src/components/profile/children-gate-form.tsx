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
import { isChildComplete } from "@/lib/users/profile-fields";

// Blocking family gate for staff. A short flow with explicit yes/no questions:
//
//   1. "Do you have a spouse?"  Yes -> add spouse (first/last/email).
//   2. "Do you have children?"  Yes -> add each child with full details
//      (multiple allowed). Mandatory: at least one complete child before the
//      Hub unblocks. No -> clears the gate.
//
// Spouse is optional and never blocks; the complete-child requirement only
// applies when they actually have children. `users.has_children` drives the
// mandatory children logic and is the only piece persisted server-side here.
type Step =
  | "spouse-ask"
  | "spouse-add"
  | "children-ask"
  | "children-add";

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
  // add-children step; otherwise start at the spouse question.
  const [step, setStep] = useState<Step>(
    hasChildren === true ? "children-add" : "spouse-ask"
  );

  const spouseMembers = members.filter((m) => m.relationship === "spouse");
  const childMembers = members.filter((m) => m.relationship === "child");

  // Persist the children yes/no answer (users.has_children).
  async function answerChildren(value: boolean) {
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
      // "Yes" -> add step (router.refresh() re-renders but doesn't remount, so
      // advance locally). "No" -> refresh clears the gate.
      if (value) setStep("children-add");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // Explicit advance from the children step — only once at least one child is
  // fully complete (checked against the saved records so the user isn't
  // silently bounced).
  async function continueFromChildren() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/household");
      const json = await res.json().catch(() => ({}));
      const list: HouseholdMember[] = Array.isArray(json.members)
        ? json.members
        : [];
      const hasCompleteChild = list.some(
        (m) => m.relationship === "child" && isChildComplete(m)
      );
      if (!hasCompleteChild) {
        setError(
          "Please add at least one child with all their details filled in before continuing."
        );
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // ── Step 1a: Do you have a spouse? ───────────────────────────
  if (step === "spouse-ask") {
    return (
      <Card className="w-full max-w-md shadow-2xl">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Do you have a spouse?</CardTitle>
          <CardDescription>
            We keep your immediate family on record. Please let us know.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Button className="flex-1" onClick={() => setStep("spouse-add")}>
              Yes
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setStep("children-ask")}
            >
              No
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Step 1b: Add spouse (first / last / email) ───────────────
  if (step === "spouse-add") {
    return (
      <Card className="w-full max-w-2xl shadow-2xl">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Add your spouse</CardTitle>
          <CardDescription>
            We just need their first name, last name and email so their own
            account can be linked later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <HouseholdMembers
            initialMembers={spouseMembers}
            defaultRelationship="spouse"
            refreshRouterOnChange={false}
          />
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setStep("spouse-ask")}
            >
              ← Back
            </Button>
            <Button className="flex-1" onClick={() => setStep("children-ask")}>
              Continue
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Step 2a: Do you have children? ───────────────────────────
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
              onClick={() => answerChildren(true)}
              disabled={saving}
            >
              Yes, I have children
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => answerChildren(false)}
              disabled={saving}
            >
              No
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => setStep("spouse-ask")}
            disabled={saving}
          >
            ← Back
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Step 2b: Add children (multiple, full details) ───────────
  return (
    <Card className="w-full max-w-2xl shadow-2xl">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Add your children</CardTitle>
        <CardDescription>
          Add each child with their full details — name, date of birth, gender,
          passport, and health insurance (plus visa if they&rsquo;re
          international). You can add more than one; use &ldquo;+ Add child&rdquo;
          for each. Continue once every child is completed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* refreshRouterOnChange={false}: saving a child must NOT auto-advance
            the gate — the user stays here to add more until they click
            Continue. */}
        <HouseholdMembers
          initialMembers={childMembers}
          requireComplete
          defaultRelationship="child"
          selfDefaults={selfDefaults}
          refreshRouterOnChange={false}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => setStep("children-ask")}
            disabled={saving}
          >
            ← Back
          </Button>
          <Button
            className="flex-1"
            onClick={continueFromChildren}
            disabled={saving}
          >
            {saving ? "Checking…" : "Continue"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
