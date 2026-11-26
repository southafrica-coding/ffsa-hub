"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { MastheadButton, SectionBar, StatusPill } from "@/components/ffsa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { OkrCycle } from "@/types/okrs";

export function CyclesManager({ cycles }: { cycles: OkrCycle[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  async function makeCurrent(cycle: OkrCycle) {
    const res = await fetch(`/api/okrs/cycles/${cycle.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_current: true }),
    });
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error ?? "Could not switch cycle");
      return;
    }
    toast.success(`${cycle.name} is now the current cycle`);
    router.refresh();
  }

  return (
    <>
      <div className="mb-5">
        <MastheadButton onClick={() => setCreating(true)}>New cycle</MastheadButton>
      </div>

      <SectionBar title="Cycles" meta={`${cycles.length}`} />
      <div className="border-x border-b border-rule">
        {cycles.length === 0 ? (
          <p className="px-4 py-3 text-[12.5px] text-[color:var(--text-secondary)] md:px-5">
            No cycles yet.
          </p>
        ) : (
          cycles.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3.5 last:border-b-0 md:px-5"
            >
              <div className="flex items-center gap-3">
                <span className="font-display text-[16px] font-bold text-ink">{c.name}</span>
                {c.is_current && <StatusPill tone="good">Current</StatusPill>}
              </div>
              <div className="flex items-center gap-4">
                <span className="font-mono text-[10px] tracking-[0.08em] text-[color:var(--text-tertiary)]">
                  {c.starts_on} → {c.ends_on}
                </span>
                {!c.is_current && (
                  <button
                    type="button"
                    onClick={() => makeCurrent(c)}
                    className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--text-muted)] underline hover:text-ink"
                  >
                    Make current
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {creating && <NewCycleDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function NewCycleDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const res = await fetch("/api/okrs/cycles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        // The slug is the URL's ?cycle= value; deriving it keeps the form to
        // one name field rather than asking for the same thing twice.
        slug: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        starts_on: startsOn,
        ends_on: endsOn,
      }),
    });
    setSaving(false);

    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Could not create that cycle");
      return;
    }
    // Deliberately not made current: opening next year's cycle in advance
    // should not swap the wall out from under everyone mid-year.
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New cycle</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="cycle-name">Name</Label>
            <Input
              id="cycle-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="2027"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="cycle-start">Starts</Label>
              <Input
                id="cycle-start"
                type="date"
                required
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="cycle-end">Ends</Label>
              <Input
                id="cycle-end"
                type="date"
                required
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            The new cycle starts closed. Make it current when the team is ready to work in it.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || name.trim() === ""}>
              {saving ? "Saving…" : "Create cycle"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
