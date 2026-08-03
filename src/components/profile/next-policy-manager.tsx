"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export type PendingPolicy = {
  provider: string;
  policy_number: string | null;
  expiry_date: string; // YYYY-MM-DD
};

// Format a YYYY-MM-DD value as "7 Aug 2026" (UTC so a date-only value doesn't
// drift across the day boundary). Mirrors fmt() in insurance-history.tsx.
function fmt(value: string): string {
  const iso = value.length <= 10 ? `${value}T00:00:00Z` : value;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return value;
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(ms));
}

// Manage the QUEUED (next) health-insurance policy on the member's own profile:
// shows the queued policy with a NEXT badge, and lets them add / replace /
// remove it. The current policy stays on its own Edit button; this only ever
// touches the next_health_insurance_* columns via /api/profile/insurance-next.
export function NextPolicyManager({
  pending,
  currentExpiry,
  providerOptions,
}: {
  pending: PendingPolicy | null;
  currentExpiry: string | null; // YYYY-MM-DD of the current policy
  providerOptions: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [provider, setProvider] = useState(pending?.provider ?? "");
  const [policyNumber, setPolicyNumber] = useState(pending?.policy_number ?? "");
  const [expiry, setExpiry] = useState(pending?.expiry_date ?? "");

  function openDialog() {
    setProvider(pending?.provider ?? "");
    setPolicyNumber(pending?.policy_number ?? "");
    setExpiry(pending?.expiry_date ?? "");
    setError(null);
    setOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/insurance-next", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          policy_number: policyNumber || null,
          expiry_date: expiry,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Couldn't save the next policy. Please try again.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!window.confirm("Remove the queued next policy?")) return;
    setRemoving(true);
    try {
      const res = await fetch("/api/profile/insurance-next", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Couldn't remove the next policy. Please try again.");
        return;
      }
      router.refresh();
    } catch {
      alert("Network error. Please try again.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="space-y-2">
      {pending ? (
        <div className="rounded-lg border border-dashed px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium break-words">{pending.provider}</span>
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              Next
            </span>
          </div>
          {pending.policy_number && (
            <div className="text-xs text-muted-foreground mt-0.5">
              Policy no. {pending.policy_number}
            </div>
          )}
          <div className="text-xs text-muted-foreground mt-0.5">
            Expires {fmt(pending.expiry_date)}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-primary">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
            {currentExpiry
              ? `Becomes active after ${fmt(currentExpiry)}`
              : "Becomes active when your current policy expires"}
          </div>
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="outline" size="sm" className="h-7" onClick={openDialog}>
              Replace
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-muted-foreground hover:text-destructive"
              disabled={removing}
              onClick={handleRemove}
            >
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" className="h-8" onClick={openDialog}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add next policy
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending ? "Replace next policy" : "Add next policy"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Line up your next policy now. It stays queued and automatically becomes
              your current policy the day after your current one expires.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="next-provider">Provider</Label>
              <Input
                id="next-provider"
                list="next-ins-providers"
                required
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder="e.g. Discovery Health"
              />
              <datalist id="next-ins-providers">
                {providerOptions.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="next-policy-number">Policy number</Label>
              <Input
                id="next-policy-number"
                value={policyNumber}
                onChange={(e) => setPolicyNumber(e.target.value)}
                placeholder="e.g. 123456789"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="next-expiry">Expiry date</Label>
              <Input
                id="next-expiry"
                type="date"
                required
                value={expiry}
                min={currentExpiry ?? undefined}
                onChange={(e) => setExpiry(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Must be after your current policy&rsquo;s expiry
                {currentExpiry ? ` (${fmt(currentExpiry)})` : ""}.
              </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? "Saving…" : pending ? "Replace policy" : "Save policy"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
