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

// Blocking step shown once, right after a new account is matched to an
// existing household (migration 181): someone already on the Hub entered this
// person as their spouse using this email address.
//
// Until "Yes" is clicked the match is only PENDING — the user's household_id
// is still NULL, so they can see nothing of that household. The one thing that
// crosses the boundary is the name below, resolved server-side. That is what
// makes this screen the security check and not a formality: a mistyped or
// stale spouse email must be caught here, by a human who knows the answer.
export function HouseholdLinkConfirmForm({
  displayName,
  hasOwnFamilyData,
}: {
  displayName: string;
  // They already added family of their own before confirming (rare — only via
  // the invite/acceptance paths). Confirming merges it into the household.
  hasOwnFamilyData?: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function respond(action: "confirm" | "decline") {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/household/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.error || "Could not save your answer. Please try again."
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

  return (
    <Card className="w-full max-w-md shadow-2xl">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">
          Are you {displayName}&rsquo;s spouse?
        </CardTitle>
        <CardDescription>
          {displayName} listed you as their spouse using this email address. If
          that&rsquo;s you, we&rsquo;ll join you to their family record — their
          spouse and children details are already filled in, so you won&rsquo;t
          have to enter them again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasOwnFamilyData && (
          <p className="text-sm text-muted-foreground">
            Any family members you&rsquo;ve already added will be moved into the
            shared record.
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-3">
          <Button
            className="flex-1"
            onClick={() => respond("confirm")}
            disabled={saving}
          >
            Yes, that&rsquo;s me
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => respond("decline")}
            disabled={saving}
          >
            No, that&rsquo;s not me
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Choose &ldquo;No&rdquo; if you don&rsquo;t recognise this name —
          nothing will be shared and you&rsquo;ll set up your own family record.
        </p>
      </CardContent>
    </Card>
  );
}
