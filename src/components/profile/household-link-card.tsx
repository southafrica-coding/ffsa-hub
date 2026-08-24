"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// Shown on the profile when this account shares its family record with a
// spouse's account (migration 181). Its only job is to make the link visible
// and reversible — if the family below isn't yours, you can leave.
//
// Leaving does NOT copy the family across: children's passport and insurance
// details stay with the original household rather than being duplicated into
// a second one. The copy says so, because it's not what people expect.
//
// The confirm step is inline rather than a popover — popovers have bitten us
// in Safari before.
export function HouseholdLinkCard({ linkedAt }: { linkedAt: string | null }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!linkedAt) return null;

  async function unlink() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/household/link", {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not unlink. Please try again.");
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border bg-muted/40 p-4 text-sm">
      <p className="font-medium">Shared with your spouse&rsquo;s account</p>
      <p className="mt-1 text-muted-foreground">
        You and your spouse share one family record, so anything either of you
        changes below is visible to you both.
      </p>
      {error && <p className="mt-2 text-destructive">{error}</p>}
      {confirming ? (
        <div className="mt-3 space-y-3">
          <p className="text-muted-foreground">
            If you leave, the family members below stay with your
            spouse&rsquo;s record &mdash; they won&rsquo;t be copied across, so
            you&rsquo;ll need to add your own. Are you sure?
          </p>
          <div className="flex gap-3">
            <Button
              variant="destructive"
              size="sm"
              onClick={unlink}
              disabled={saving}
            >
              Yes, leave this family record
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirming(false)}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => setConfirming(true)}
        >
          This isn&rsquo;t my family
        </Button>
      )}
    </div>
  );
}
