"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Confirmation for the Super Admin tier, in both directions.
//
// Super Admin is the one grant with no ceiling — it bypasses every role and
// permission check — so it asks before it acts, and names the alternative:
// General Admin is the same reach minus the Records Library, which is the
// distinction most of these decisions actually turn on.
//
// General Admin gets the plainer shared ConfirmAccessDialog (see
// permission-manager.tsx): every access change asks first, but only this one
// needs the Records Library explanation.

export function SuperAdminConfirmDialog({
  userId,
  personName,
  mode,
  open,
  onOpenChange,
}: {
  userId: string;
  personName: string;
  /** "grant" makes them a super admin; "remove" takes it away. */
  mode: "grant" | "remove";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const granting = mode === "grant";

  async function act() {
    setBusy(true);
    try {
      const res = await fetch(
        granting ? "/api/admin/grant-role" : "/api/admin/revoke-role",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId, role_name: "super_admin" }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not update Super Admin");
        return;
      }
      toast.success(granting ? "Super Admin granted" : "Super Admin removed");
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error("Could not update Super Admin");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {granting
              ? "Are you sure this user needs Super Admin rights?"
              : "Remove Super Admin?"}
          </DialogTitle>
          <DialogDescription asChild>
            {granting ? (
              <div className="space-y-2">
                <p>
                  {personName} will bypass every role and permission check —
                  unrestricted access to every module and every record,{" "}
                  <strong>including the Records Library</strong>.
                </p>
                <p>
                  If they don&rsquo;t need the Records Library,{" "}
                  <strong>General Admin</strong> gives them everything else.
                </p>
              </div>
            ) : (
              <p>
                {personName} will lose unrestricted access and fall back to
                their other roles and permissions.
              </p>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={act} disabled={busy}>
            {busy
              ? "Saving…"
              : granting
              ? "Make Super Admin"
              : "Remove Super Admin"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
