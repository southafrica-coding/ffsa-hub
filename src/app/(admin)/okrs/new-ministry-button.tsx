"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { MastheadButton } from "@/components/ffsa";

/**
 * Creates a ministry from the OKR wall.
 *
 * Not the Ministry module's NewMinistryButton, though the form is the same
 * two fields: that one refreshes the ministry list, this one sends you
 * straight into writing the new ministry's first objective, which is the
 * whole reason you were on this page.
 *
 * Admin-only, matching POST /api/ministries. The gate matters more than it
 * looks: staff_ministries is also the department vocabulary behind every
 * user's profile dropdown, and there is no way to delete one through the UI.
 */
export function NewMinistryButton({ cycleSlug }: { cycleSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [duplicate, setDuplicate] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    setDuplicate(false);

    const res = await fetch("/api/ministries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      // A name clash is not really a failure — the ministry they want is
      // already on the wall. Keep the dialog open and point them at it.
      if (typeof body.error === "string" && body.error.includes("already exists")) {
        setDuplicate(true);
        return;
      }
      toast.error(body.error ?? "Could not create the ministry");
      return;
    }

    toast.success(`${body.ministry.name} created`);
    setOpen(false);
    setName("");
    setDescription("");
    router.push(`/okrs/${body.ministry.id}?cycle=${cycleSlug}`);
  }

  return (
    <>
      <MastheadButton tone="outline" onClick={() => setOpen(true)}>
        New ministry
      </MastheadButton>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New ministry</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="okr-ministry-name">Name</Label>
              <Input
                id="okr-ministry-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setDuplicate(false);
                }}
                placeholder="e.g. Worship"
                autoFocus
              />
              {duplicate && (
                <p className="text-[13px] text-[color:var(--destructive)]">
                  That ministry already exists — close this and pick it from the wall.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="okr-ministry-desc">Description (optional)</Label>
              <Input
                id="okr-ministry-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this ministry does"
              />
            </div>

            <p className="text-[13px] text-[color:var(--text-secondary)]">
              This adds a real ministry — it will show up on the Ministries tab and in
              everyone&rsquo;s Department list, not just here.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy || !name.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
