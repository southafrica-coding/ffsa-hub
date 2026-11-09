"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Check, AlertTriangle, Clock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type SendPhase = "confirm" | "sending" | "done" | "error";

export type SendProgress = {
  sent: number;
  failed: number;
  /** Resend said "try later" — the cron sends the rest server-side. */
  handedOff: boolean;
};

type Stats = {
  total: number;
  sent: number;
  delivered: number;
  opened: number;
  bounced: number;
  status: string;
};

// Send confirmation + live progress + delivery confirmation.
//
// A send used to be a browser confirm() followed by one line of text, which
// answered "did I click it" but never "did anything actually arrive". This
// carries the whole way through: what's about to go out, how far the send has
// got, and then the provider's own delivery counts as the webhooks land.
export function SendDialog({
  open,
  phase,
  campaignId,
  campaignName,
  subject,
  fromName,
  audienceCount,
  progress,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  phase: SendPhase;
  campaignId: string;
  campaignName: string;
  subject: string;
  fromName: string;
  audienceCount: number;
  progress: SendProgress;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Poll delivery counters once the send finishes. Resend's delivery
  // webhooks usually land within a couple of seconds but can take minutes,
  // so the numbers climb after the send itself is done. Poll quickly at first
  // (the first check runs the instant the send ends — typically BEFORE any
  // confirmation has arrived, which is how "0 delivered" used to sit on screen
  // for a send that had in fact delivered), then back off; stop once
  // everything is accounted for or after three minutes.
  useEffect(() => {
    if (!open || phase !== "done") return;
    let cancelled = false;
    const startedAt = Date.now();

    async function poll() {
      // no-store: a cached first answer ("0 so far") must never be reused.
      const res = await fetch(`/api/campaigns/${campaignId}/stats`, {
        cache: "no-store",
      }).catch(() => null);
      if (cancelled) return;
      if (res?.ok) {
        const s = (await res.json()) as Stats;
        setStats(s);
        const settled = s.delivered + s.bounced >= s.sent && s.sent > 0;
        if (settled) return;
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed > 180_000) return;
      timer.current = setTimeout(poll, elapsed < 30_000 ? 1500 : 5000);
    }
    // Give the first webhooks a moment rather than reading an empty count.
    timer.current = setTimeout(poll, 1500);

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [open, phase, campaignId]);

  const total = audienceCount || progress.sent;
  const pct = total > 0 ? Math.min(100, Math.round((progress.sent / total) * 100)) : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Never let a send be dismissed mid-flight — closing the dialog would
        // read as "cancelled" when the loop is still running.
        if (!o && phase !== "sending") onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            {phase === "confirm"
              ? "Send this email?"
              : phase === "sending"
                ? "Sending…"
                : phase === "error"
                  ? "Send failed"
                  : "Sent"}
          </DialogTitle>
        </DialogHeader>

        {phase === "confirm" && (
          <div className="space-y-3">
            <dl className="space-y-1.5 rounded border bg-muted/30 p-3 text-sm">
              <Row label="Email" value={campaignName} />
              <Row label="Subject" value={subject || "—"} />
              <Row label="From" value={fromName} />
              <Row
                label="Recipients"
                value={`${audienceCount} contact${audienceCount === 1 ? "" : "s"}`}
              />
            </dl>
            <p className="text-xs text-muted-foreground">
              This sends immediately and can’t be undone. Anyone unsubscribed,
              suppressed, or with an undeliverable address is already left out
              of this number.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={onConfirm}>Send now</Button>
            </div>
          </div>
        )}

        {phase === "sending" && (
          <div className="space-y-3">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-sky-500 transition-all duration-300"
                style={{ width: `${Math.max(pct, 4)}%` }}
              />
            </div>
            <p className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-sky-500" />
              {progress.sent} of {total} handed to the mail provider
              {progress.failed > 0 ? ` · ${progress.failed} failed` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              Keep this tab open if you can — but the send continues on the
              server either way.
            </p>
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-3">
            <p className="flex items-start gap-2 text-sm text-red-500">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error ?? "Something went wrong."}
            </p>
            {progress.sent > 0 && (
              <p className="text-xs text-muted-foreground">
                {progress.sent} email{progress.sent === 1 ? "" : "s"} had
                already gone out before this failed. Re-sending will only go to
                contacts who haven’t received it.
              </p>
            )}
            <div className="flex justify-end">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-500">
              <Check className="h-4 w-4" />
              {progress.sent} email{progress.sent === 1 ? "" : "s"} accepted by
              the mail provider
              {progress.failed > 0 ? ` · ${progress.failed} failed` : ""}
            </p>

            {progress.handedOff && (
              <p className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                The mail provider asked us to slow down, so the rest goes out
                automatically shortly. You can close this tab.
              </p>
            )}

            <div className="rounded border p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Delivery confirmations
              </p>
              {stats && stats.sent > 0 && (
                <p className="mb-2 text-xs">
                  <span className="font-medium">
                    {stats.delivered} of {stats.sent}
                  </span>{" "}
                  confirmed delivered
                  {stats.delivered + stats.bounced < stats.sent && (
                    <span className="text-muted-foreground"> · waiting on the rest…</span>
                  )}
                </p>
              )}
              {stats ? (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Stat label="Delivered" value={stats.delivered} tone="good" />
                  <Stat label="Bounced" value={stats.bounced} tone="bad" />
                  <Stat label="Opened" value={stats.opened} />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Checking…</p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                {stats && stats.delivered + stats.bounced >= stats.sent
                  ? "Every email is accounted for."
                  : "Mailboxes confirm delivery over the next few minutes — these numbers keep climbing. The full breakdown is on this page after you close."}
              </p>
            </div>

            <div className="flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 truncate">{value}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good" | "bad";
}) {
  const color =
    tone === "good" && value > 0
      ? "text-emerald-500"
      : tone === "bad" && value > 0
        ? "text-red-500"
        : "text-foreground";
  return (
    <div>
      <div className={`text-lg font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
