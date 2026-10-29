"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// A delete that asks first, and says exactly what is going.
//
// Replaces window.confirm(), which some browsers suppress after a dialog has
// been dismissed once and which can't name the thing being deleted in any
// way a reader notices. `itemName` is shown on its own line, quoted, so the
// person confirming sees which objective or key result it is — not just
// "this one".

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  itemName,
  consequence,
  confirmLabel = "Delete",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** e.g. "Delete this objective?" */
  title: string;
  /** The thing being deleted, quoted back to the reader. */
  itemName: string;
  /** What else goes with it, and that it can't be undone. */
  consequence: ReactNode;
  confirmLabel?: string;
  /** Resolve true when the delete went through (the dialog closes), false to keep it open. */
  onConfirm: () => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      if (await onConfirm()) onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p className="border-l-2 border-destructive pl-3 font-medium text-ink">
                &ldquo;{itemName}&rdquo;
              </p>
              <p>{consequence}</p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy} autoFocus>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? "Deleting…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
