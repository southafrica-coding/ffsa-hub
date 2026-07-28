"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  Pencil,
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
  cancellationMessage,
}: {
  eventId: string;
  status: Status;
  cancellationMessage?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  // Cancelling is a two-step within the close-out dialog: pick "cancelled",
  // then write the buyer-facing note before confirming.
  const [cancelForm, setCancelForm] = useState(false);
  const [msg, setMsg] = useState(cancellationMessage ?? "");
  // Editing the note after the event is already cancelled.
  const [noteOpen, setNoteOpen] = useState(false);

  const isClosed = status === "completed" || status === "cancelled";

  async function patch(
    body: Record<string, unknown>,
    successMsg: string,
    onDone?: () => void
  ) {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Couldn't save. Please try again.");
      return;
    }
    onDone?.();
    toast.success(successMsg);
    router.refresh();
  }

  function resetCloseDialog(open: boolean) {
    setCloseOpen(open);
    if (!open) {
      setCancelForm(false);
      setMsg(cancellationMessage ?? "");
      setErr(null);
    }
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
            onClick={() => patch({ status: "published" }, "Event published")}
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
            onClick={() => patch({ status: "draft" }, "Reverted to draft")}
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
            onClick={() => patch({ status: "draft" }, "Event reopened as a draft")}
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
      {/* Once cancelled, the note is editable on its own — it drives the
          public "event cancelled" notice and any refund emails. */}
      {status === "cancelled" && (
        <button
          type="button"
          onClick={() => {
            setMsg(cancellationMessage ?? "");
            setErr(null);
            setNoteOpen(true);
          }}
          className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <Pencil className="h-3 w-3" />
          {cancellationMessage ? "Edit cancellation note" : "Add a cancellation note"}
        </button>
      )}
      {err && !closeOpen && !noteOpen && (
        <p className="text-[11px] text-red-600">{err}</p>
      )}

      {/* Close-out dialog */}
      <Dialog open={closeOpen} onOpenChange={resetCloseDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {cancelForm ? "Cancel this event" : "Close out this event"}
            </DialogTitle>
          </DialogHeader>

          {cancelForm ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Add a message explaining why the event is being cancelled. Ticket
                holders see it on the event page and in any refund email you send.
                You can refund everyone from the Orders tab.
              </p>
              <Textarea
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                rows={4}
                placeholder="e.g. Due to unforeseen circumstances the event can no longer go ahead. All ticket holders will be refunded in full."
                disabled={busy}
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCancelForm(false)}
                  disabled={busy}
                >
                  Back
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    patch(
                      { status: "cancelled", cancellation_message: msg },
                      "Event marked cancelled",
                      () => resetCloseDialog(false)
                    )
                  }
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  {busy ? "Cancelling…" : "Cancel event"}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                The public event page stops working immediately and no further
                tickets can be sold. The event drops out of the default Events
                list but keeps all its orders, check-ins and form responses — you
                can reopen it at any time.
              </p>

              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    patch({ status: "completed" }, "Event marked completed", () =>
                      resetCloseDialog(false)
                    )
                  }
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
                  onClick={() => {
                    setErr(null);
                    setCancelForm(true);
                  }}
                  className="w-full text-left rounded-md border p-3 hover:bg-accent disabled:opacity-50 transition-colors"
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <XCircle className="h-4 w-4" /> Mark as cancelled
                  </span>
                  <span className="block text-xs text-muted-foreground mt-1">
                    The event is not going ahead. You&apos;ll add a note for ticket
                    holders next, then refund them from the Orders tab.
                  </span>
                </button>
              </div>
            </>
          )}

          {busy && !cancelForm && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Saving…
            </p>
          )}
          {err && <p className="text-[11px] text-red-600">{err}</p>}
        </DialogContent>
      </Dialog>

      {/* Edit-note dialog (event already cancelled) */}
      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancellation note</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Shown to ticket holders on the event page and in any refund email
            you send. Leave empty to remove it.
          </p>
          <Textarea
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            rows={4}
            placeholder="e.g. Due to unforeseen circumstances the event can no longer go ahead. All ticket holders will be refunded in full."
            disabled={busy}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setNoteOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                patch({ cancellation_message: msg }, "Cancellation note saved", () =>
                  setNoteOpen(false)
                )
              }
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              {busy ? "Saving…" : "Save note"}
            </Button>
          </div>
          {err && <p className="text-[11px] text-red-600">{err}</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
