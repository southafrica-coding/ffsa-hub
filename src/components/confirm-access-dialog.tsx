"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// The "Are you sure?" step in front of every change to someone's access —
// membership role, job titles, admin tiers, permission grants. The title says
// plainly what will change and for whom; Cancel sends nothing.
//
// Pair it with accessChangeReducer (lib/users/access-change.ts) so the control
// behind it keeps showing the saved value until Confirm.

export function ConfirmAccessDialog({
  open,
  title,
  children,
  confirmLabel = "Confirm",
  busy = false,
  destructive = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  /** Detail under the title: the consequences, a list of changes, a warning. */
  children?: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  /** Removals read as removals: the confirm button turns destructive. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      // Escape / overlay click is a Cancel — but not mid-save, when the
      // request is already out.
      onOpenChange={(o) => !o && !busy && onCancel()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {children ? (
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">{children}</div>
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">
              Confirm or cancel this change.
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Saving…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
