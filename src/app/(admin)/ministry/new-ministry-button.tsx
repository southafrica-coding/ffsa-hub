"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DEFAULT_MINISTRY_TYPE,
  MINISTRY_TYPES,
  MINISTRY_TYPE_LABELS,
  type MinistryType,
} from "@/lib/ministries/ministry-type";

export function NewMinistryButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ministryType, setMinistryType] =
    useState<MinistryType>(DEFAULT_MINISTRY_TYPE);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    const res = await fetch("/api/ministries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim() || null,
        ministry_type: ministryType,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      toast.error(b.error ?? "Could not create the ministry");
      return;
    }
    toast.success("Ministry created");
    setName("");
    setDescription("");
    setMinistryType(DEFAULT_MINISTRY_TYPE);
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-1 h-4 w-4" /> New ministry
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New ministry</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ministry-name">Name</Label>
            <Input
              id="ministry-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Worship"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ministry-type">Type</Label>
            {/* Native <select> on purpose — Radix popover selects don't open
                in Safari (PR #193). */}
            <select
              id="ministry-type"
              className="h-10 w-full"
              value={ministryType}
              onChange={(e) => setMinistryType(e.target.value as MinistryType)}
            >
              {MINISTRY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {MINISTRY_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ministry-desc">Description (optional)</Label>
            <Input
              id="ministry-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this ministry does"
            />
          </div>
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
  );
}
