"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar, Copy, Check } from "lucide-react";
import type { FollowupDetail } from "@/services/event-followup";

type Scheduling = NonNullable<FollowupDetail["scheduling"]>;

const SITE_URL = "https://ffsahub.com";

function formatSlot(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SchedulingSection({
  enrollmentId,
  scheduling,
  onChanged,
}: {
  enrollmentId: string;
  scheduling: Scheduling | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<{
    id: string;
    starts_at: string;
  } | null>(null);
  const [confirmMsg, setConfirmMsg] = useState("");

  async function handleConfirm(slotId: string, message: string) {
    if (!scheduling) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/contacts/event-followup/${enrollmentId}/scheduling/${scheduling.id}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slot_id: slotId, message: message.trim() || null }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to confirm slot");
        return;
      }
      setConfirmTarget(null);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!scheduling) return;
    if (!confirm("Cancel this scheduling request?")) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/contacts/event-followup/${enrollmentId}/scheduling/${scheduling.id}/cancel`,
        { method: "POST" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to cancel");
        return;
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  // No active request → show the trigger button
  if (!scheduling) {
    return (
      <div className="mt-6">
        <p
          style={{
            fontSize: "9px",
            letterSpacing: "0.25em",
            fontWeight: 700,
            color: "var(--text-primary)",
            textTransform: "uppercase",
          }}
        >
          Scheduling
        </p>
        <div
          className="mt-2 p-4 flex items-center justify-between gap-3"
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--rule)",
          }}
        >
          <div style={{ color: "var(--text-tertiary)", fontSize: "13px" }}>
            No availability request yet. Send the recipient a link to pick
            times.
          </div>
          <Button
            onClick={() => setRequestOpen(true)}
            disabled={busy}
            style={{
              background: "#FFB801",
              color: "#0A0A0A",
              fontWeight: 700,
            }}
          >
            <Calendar className="h-3.5 w-3.5 mr-1.5" />
            Request availability
          </Button>
        </div>
        <RequestDialog
          enrollmentId={enrollmentId}
          open={requestOpen}
          onClose={() => setRequestOpen(false)}
          onCreated={() => {
            setRequestOpen(false);
            onChanged();
          }}
        />
      </div>
    );
  }

  const expired =
    scheduling.status === "pending" &&
    new Date(scheduling.expires_at) < new Date();

  const recipientSlots = scheduling.slots.filter(
    (s) => s.proposed_by === "recipient"
  );
  const chosenSlot = scheduling.slots.find((s) => s.is_chosen) ?? null;
  const magicLinkUrl = `${SITE_URL}/schedule/${scheduling.magic_token}`;

  return (
    <div className="mt-6">
      <p
        style={{
          fontSize: "9px",
          letterSpacing: "0.25em",
          fontWeight: 700,
          color: "var(--text-primary)",
          textTransform: "uppercase",
        }}
      >
        Scheduling
      </p>

      <div
        className="mt-2 p-4"
        style={{
          background: "var(--surface-1)",
          border: "1px solid var(--rule)",
        }}
      >
        <StatusPill status={scheduling.status} expired={expired} />

        <div className="mt-3 space-y-2">
          {scheduling.status === "pending" && !expired && (
            <>
              <p style={{ color: "var(--text-quiet)", fontSize: "13px" }}>
                Recipient hasn&rsquo;t picked times yet. Link expires{" "}
                {formatSlot(scheduling.expires_at)}.
              </p>
              <MagicLinkRow url={magicLinkUrl} />
            </>
          )}

          {scheduling.status === "pending" && expired && (
            <p style={{ color: "hsl(var(--destructive))", fontSize: "13px" }}>
              This link has expired. Cancel and send a new request.
            </p>
          )}

          {scheduling.status === "awaiting_selection" && (
            <>
              <p style={{ color: "var(--text-quiet)", fontSize: "13px" }}>
                {recipientSlots.length} time
                {recipientSlots.length === 1 ? "" : "s"} submitted. Pick one to
                confirm:
              </p>
              <div className="space-y-1.5">
                {recipientSlots.map((slot) => (
                  <button
                    key={slot.id}
                    onClick={() => {
                      setConfirmTarget({ id: slot.id, starts_at: slot.starts_at });
                      setConfirmMsg("");
                    }}
                    disabled={busy}
                    className="w-full flex items-center justify-between gap-3 p-2.5 text-left transition-colors hover:bg-white/5"
                    style={{
                      border: "1px solid var(--rule-strong)",
                      color: "var(--text-primary)",
                      fontSize: "13px",
                      background: "var(--surface-2)",
                    }}
                  >
                    <span>{formatSlot(slot.starts_at)}</span>
                    <span
                      style={{
                        fontSize: "10px",
                        letterSpacing: "0.1em",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        color: "var(--text-primary)",
                      }}
                    >
                      Pick this
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {scheduling.status === "scheduled" && chosenSlot && (
            <p
              style={{
                color: "var(--green-text)",
                fontSize: "14px",
                fontWeight: 600,
              }}
            >
              ✓ Confirmed for {formatSlot(chosenSlot.starts_at)}
            </p>
          )}

          {scheduling.status === "cancelled" && (
            <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>
              Cancelled
              {scheduling.cancelled_at
                ? ` on ${formatSlot(scheduling.cancelled_at)}`
                : ""}
              .
            </p>
          )}
        </div>

        {(scheduling.status === "pending" ||
          scheduling.status === "awaiting_selection") && (
          <div className="mt-3 flex justify-end">
            <button
              onClick={handleCancel}
              disabled={busy}
              style={{
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              Cancel request
            </button>
          </div>
        )}

        {scheduling.status === "cancelled" && (
          <div className="mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRequestOpen(true)}
              style={{
                borderColor: "var(--rule-strong)",
                color: "var(--text-quiet)",
              }}
            >
              Request again
            </Button>
          </div>
        )}
      </div>

      <RequestDialog
        enrollmentId={enrollmentId}
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        onCreated={() => {
          setRequestOpen(false);
          onChanged();
        }}
      />

      <Dialog
        open={!!confirmTarget}
        onOpenChange={(o) => !o && setConfirmTarget(null)}
      >
        <DialogContent
          style={{
            background: "var(--ink-bg)",
            borderColor: "var(--rule)",
            color: "var(--text-primary)",
          }}
        >
          <DialogHeader>
            <DialogTitle style={{ color: "var(--text-primary)" }}>
              Confirm this time
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-1">
            {confirmTarget && (
              <p
                style={{
                  fontSize: "14px",
                  color: "var(--text-primary)",
                  fontWeight: 700,
                }}
              >
                {formatSlot(confirmTarget.starts_at)} ·{" "}
                {scheduling.duration_minutes} min
              </p>
            )}
            <div>
              <Label
                htmlFor="confirm-msg"
                style={{
                  fontSize: "11px",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}
              >
                Personal message (optional)
              </Label>
              <Textarea
                id="confirm-msg"
                value={confirmMsg}
                onChange={(e) => setConfirmMsg(e.target.value)}
                placeholder="e.g. Can't wait to chat — I'll call you on WhatsApp at this time."
                className="mt-1"
                rows={4}
              />
              <p
                style={{
                  fontSize: "11px",
                  color: "var(--text-secondary)",
                  marginTop: "6px",
                }}
              >
                Appears in the confirmation email they receive, alongside the
                calendar invite.
              </p>
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              onClick={() => setConfirmTarget(null)}
              disabled={busy}
              style={{ borderColor: "var(--rule-strong)", color: "var(--text-quiet)" }}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                confirmTarget && handleConfirm(confirmTarget.id, confirmMsg)
              }
              disabled={busy}
              style={{
                background: "#FFB801",
                color: "#0A0A0A",
                fontWeight: 700,
              }}
            >
              {busy ? "Confirming…" : "Confirm & send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusPill({
  status,
  expired,
}: {
  status: Scheduling["status"];
  expired: boolean;
}) {
  let label = status.replace("_", " ");
  let bg = "var(--surface-3)";
  let fg = "var(--text-tertiary)";

  if (expired) {
    label = "expired";
    bg = "transparent";
    fg = "hsl(var(--destructive))";
  } else if (status === "pending") {
    bg = "var(--yellow-dim)";
    fg = "var(--text-primary)";
  } else if (status === "awaiting_selection") {
    label = "needs your pick";
    bg = "var(--yellow-dim)";
    fg = "var(--text-primary)";
  } else if (status === "scheduled") {
    bg = "transparent";
    fg = "var(--green-text)";
  }

  return (
    <span
      style={{
        display: "inline-block",
        fontSize: "10px",
        fontWeight: 700,
        letterSpacing: "0.1em",
        padding: "3px 8px",
        background: bg,
        color: fg,
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
  );
}

function MagicLinkRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // no-op
    }
  }

  return (
    <div
      className="flex items-center gap-2 p-2"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--rule)",
      }}
    >
      <code
        style={{
          flex: 1,
          fontSize: "11px",
          color: "var(--text-quiet)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: "ui-monospace, monospace",
        }}
      >
        {url}
      </code>
      <button
        onClick={handleCopy}
        style={{
          background: "transparent",
          border: "1px solid var(--rule-strong)",
          padding: "4px 8px",
          color: copied ? "var(--green-text)" : "var(--text-tertiary)",
          fontSize: "11px",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
        }}
      >
        {copied ? (
          <>
            <Check className="h-3 w-3" />
            Copied
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" />
            Copy
          </>
        )}
      </button>
    </div>
  );
}

function RequestDialog({
  enrollmentId,
  open,
  onClose,
  onCreated,
}: {
  enrollmentId: string;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [duration, setDuration] = useState(30);
  const [expiryDays, setExpiryDays] = useState(7);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/contacts/event-followup/${enrollmentId}/scheduling/request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            duration_minutes: duration,
            expiry_days: expiryDays,
            message: message.trim() || null,
          }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to create request");
        return;
      }
      const data = await res.json();
      if (data.emailError) {
        alert(
          `Request created but email did not send: ${data.emailError}. Magic link: ${data.magicLink}`
        );
      }
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        style={{
          background: "var(--ink-bg)",
          borderColor: "var(--rule)",
          color: "var(--text-primary)",
        }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: "var(--text-primary)" }}>
            Request availability
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div>
            <Label htmlFor="duration" style={{ fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>
              Call duration (minutes)
            </Label>
            <Input
              id="duration"
              type="number"
              min={15}
              step={15}
              value={duration}
              onChange={(e) => setDuration(Math.max(15, parseInt(e.target.value) || 30))}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="expiry" style={{ fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>
              Link expires in (days)
            </Label>
            <Input
              id="expiry"
              type="number"
              min={1}
              max={30}
              value={expiryDays}
              onChange={(e) => setExpiryDays(Math.max(1, parseInt(e.target.value) || 7))}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="message" style={{ fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>
              Personal message (optional)
            </Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. Looking forward to hearing how you're doing!"
              className="mt-1"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={busy}
            style={{ borderColor: "var(--rule-strong)", color: "var(--text-quiet)" }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={busy}
            style={{ background: "#FFB801", color: "#0A0A0A", fontWeight: 700 }}
          >
            {busy ? "Sending…" : "Send request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
