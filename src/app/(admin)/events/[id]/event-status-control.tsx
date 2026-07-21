"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Globe,
  Loader2,
  Eye,
  EyeOff,
  Archive,
  CheckCircle2,
  XCircle,
  RotateCcw,
} from "lucide-react";

type Status = "draft" | "published" | "cancelled" | "completed";

const STATUS_VARIANT: Record<
  Status,
  "default" | "secondary" | "destructive" | "outline"
> = {
  draft: "outline",
  published: "default",
  cancelled: "destructive",
  completed: "secondary",
};

export function EventStatusControl({
  eventId,
  status,
}: {
  eventId: string;
  status: Status;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);

  const isClosed = status === "completed" || status === "cancelled";

  async function setStatus(next: Status, successMsg: string) {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Couldn't update status. Please try again.");
      return;
    }
    setCloseOpen(false);
    toast.success(successMsg);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <Badge variant={STATUS_VARIANT[status]} className="capitalize">
          {status}
        </Badge>
        {status === "draft" && (
          <Button
            size="sm"
            onClick={() => setStatus("published", "Event published")}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Globe className="h-3.5 w-3.5" />
            )}
            {busy ? "Publishing…" : "Publish event"}
          </Button>
        )}
        {status === "published" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setStatus("draft", "Reverted to draft")}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )}
            {busy ? "Reverting…" : "Revert to draft"}
          </Button>
        )}
        {isClosed ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setStatus("draft", "Event reopened as a draft")}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            {busy ? "Reopening…" : "Reopen event"}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCloseOpen(true)}
            disabled={busy}
          >
            <Archive className="h-3.5 w-3.5" />
            Close out event
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        {status === "draft" && (
          <>
            <EyeOff className="h-3 w-3" /> Draft — not visible to the public.
          </>
        )}
        {status === "published" && (
          <>
            <Eye className="h-3 w-3 text-green-600" /> Live — visible to the
            public.
          </>
        )}
        {status === "cancelled" && (
          <>
            <XCircle className="h-3 w-3" /> Cancelled — closed out and off the
            public site.
          </>
        )}
        {status === "completed" && (
          <>
            <CheckCircle2 className="h-3 w-3" /> Completed — closed out and off
            the public site.
          </>
        )}
      </p>
      {err && <p className="text-[11px] text-red-600">{err}</p>}

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Close out this event</DialogTitle>
          </DialogHeader>

          <p className="text-xs text-muted-foreground">
            The public event page stops working immediately and no further
            tickets can be sold. The event drops out of the default Events list
            but keeps all its orders, check-ins and form responses — you can
            reopen it at any time.
          </p>

          <div className="space-y-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => setStatus("completed", "Event marked completed")}
              className="w-full text-left rounded-md border p-3 hover:bg-accent disabled:opacity-50 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="h-4 w-4" /> Mark as completed
              </span>
              <span className="block text-xs text-muted-foreground mt-1">
                The event happened and is now wrapped up.
              </span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => setStatus("cancelled", "Event marked cancelled")}
              className="w-full text-left rounded-md border p-3 hover:bg-accent disabled:opacity-50 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <XCircle className="h-4 w-4" /> Mark as cancelled
              </span>
              <span className="block text-xs text-muted-foreground mt-1">
                The event is not going ahead. Existing orders are left as-is —
                refund them from the Orders tab if needed.
              </span>
            </button>
          </div>

          {busy && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Saving…
            </p>
          )}
          {err && <p className="text-[11px] text-red-600">{err}</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
