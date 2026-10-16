"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Opens right after someone is made Staff from the Users list Role dropdown,
// so their department (main ministry) is picked in the same motion instead of
// leaving them as a department-less "Staff". Native <select> on purpose —
// Radix/cmdk comboboxes don't open in Safari.

export function SetDepartmentDialog({
  userId,
  personName,
  currentDepartment,
  options,
  open,
  onOpenChange,
}: {
  userId: string;
  personName: string;
  currentDepartment: string | null;
  options: { value: string; label: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [department, setDepartment] = useState(currentDepartment ?? "");

  useEffect(() => {
    if (open) setDepartment(currentDepartment ?? "");
  }, [open, currentDepartment]);

  async function save() {
    if (!department) return;
    setBusy(true);
    const res = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ department }),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      toast.error(b.error ?? "Could not set the department");
      return;
    }
    toast.success(`Department set for ${personName}`);
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose a department</DialogTitle>
          <DialogDescription>
            {personName} is now staff. Pick the main ministry they serve in.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="staff-department">Department</Label>
          <select
            id="staff-department"
            className="flex h-9 w-full border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            autoFocus
          >
            <option value="">Select a department…</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Skip for now
          </Button>
          <Button onClick={save} disabled={busy || !department}>
            {busy ? "Saving…" : "Save department"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
