"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Mail } from "lucide-react";

type Recipient = { email: string; firstName: string; orderCount: number };

type Preview = { recipients: Recipient[]; previewHtml: string };

// Emails the already-refunded buyers of a cancelled event the reason it
// was cancelled. Always previews first (server dry-run returns the exact
// recipients + rendered HTML); nothing sends until the second click.
export function CancellationNoticeButton({
  eventId,
  hasCancellationMessage,
}: {
  eventId: string;
  hasCancellationMessage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<{ sent: number; failed: number } | null>(null);

  async function loadPreview() {
    setLoading(true);
    setErr(null);
    setPreview(null);
    setDone(null);
    const res = await fetch(`/api/events/${eventId}/send-cancellation-notice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dry_run: true }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Couldn't load the preview.");
      return;
    }
    const data = (await res.json()) as Preview;
    setPreview(data);
  }

  function openDialog() {
    setOpen(true);
    loadPreview();
  }

  async function send() {
    setSending(true);
    setErr(null);
    const res = await fetch(`/api/events/${eventId}/send-cancellation-notice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dry_run: false }),
    });
    setSending(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Send failed.");
      return;
    }
    const data = (await res.json()) as { sent: number; failed: number };
    setDone({ sent: data.sent, failed: data.failed });
    if (data.failed === 0) {
      toast.success(`Sent to ${data.sent} ${data.sent === 1 ? "person" : "people"}.`);
    } else {
      toast.warning(`Sent ${data.sent}, ${data.failed} failed.`);
    }
  }

  function onOpenChange(next: boolean) {
    if (sending) return;
    setOpen(next);
    if (!next) {
      setPreview(null);
      setErr(null);
      setDone(null);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={openDialog}
        disabled={!hasCancellationMessage}
        title={
          hasCancellationMessage
            ? undefined
            : "Add a cancellation note on the event first"
        }
      >
        <Mail className="h-3.5 w-3.5" />
        Email cancellation reason
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Email the cancellation reason to refunded buyers</DialogTitle>
          </DialogHeader>

          {loading && (
            <p className="text-sm text-muted-foreground flex items-center gap-2 py-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading recipients and preview…
            </p>
          )}

          {err && <p className="text-sm text-destructive">{err}</p>}

          {done && (
            <div className="space-y-2 text-sm">
              <p>
                Sent to <strong>{done.sent}</strong>{" "}
                {done.sent === 1 ? "person" : "people"}
                {done.failed > 0 ? `, ${done.failed} failed.` : "."}
              </p>
              <div className="flex justify-end">
                <Button size="sm" onClick={() => onOpenChange(false)}>
                  Done
                </Button>
              </div>
            </div>
          )}

          {preview && !done && (
            <div className="space-y-3">
              <p className="text-sm">
                This will email <strong>{preview.recipients.length}</strong>{" "}
                {preview.recipients.length === 1 ? "person" : "people"} who have
                already been refunded for this event. Nothing sends until you click
                the send button below.
              </p>

              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  Recipients ({preview.recipients.length})
                </summary>
                <ul className="mt-2 max-h-28 overflow-auto border p-2 bg-muted/30 space-y-0.5">
                  {preview.recipients.map((r) => (
                    <li key={r.email}>
                      {r.firstName ? `${r.firstName} · ` : ""}
                      {r.email}
                    </li>
                  ))}
                </ul>
              </details>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Preview
                </p>
                <iframe
                  title="Cancellation email preview"
                  srcDoc={preview.previewHtml}
                  className="w-full h-80 border bg-white"
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  disabled={sending}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={send}
                  disabled={sending || preview.recipients.length === 0}
                >
                  {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {sending
                    ? "Sending…"
                    : `Send to ${preview.recipients.length} ${preview.recipients.length === 1 ? "person" : "people"}`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
