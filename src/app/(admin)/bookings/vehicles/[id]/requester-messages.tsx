"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SectionBar } from "@/components/ffsa";
import type { RequesterMessageRow } from "@/lib/vehicles/requester-notify";

const KIND_LABEL: Record<RequesterMessageRow["kind"], string> = {
  message: "Message",
  submitted: "Request received",
  approved: "Approved",
  denied: "Not approved",
  reopened: "Back to pending",
  changed: "Booking updated",
  cancelled: "Cancelled",
  completed: "Completed",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function channels(r: RequesterMessageRow): string {
  if (r.via_slack && r.via_email) return "Slack + email";
  if (r.via_slack) return "Slack";
  if (r.via_email) return "Email";
  return "Not delivered";
}

/**
 * Write to the person who booked — lands as a Slack DM from the Hub bot
 * (email if they aren't on Slack) — plus the log of every update they've
 * been sent about this booking.
 */
export function RequesterMessages({
  bookingId,
  requesterName,
  rows,
}: {
  bookingId: string;
  requesterName: string | null;
  rows: RequesterMessageRow[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/vehicles/bookings/${bookingId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not send.");
        return;
      }
      toast.success(json.slack ? "Sent on Slack." : "They aren't on Slack — sent by email instead.");
      setText("");
      router.refresh();
    } catch {
      toast.error("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  const first = (requesterName ?? "").trim().split(/\s+/)[0] || "the requester";

  return (
    <div className="border border-ink bg-white">
      <SectionBar title="Messages to requester" />
      <div className="space-y-5 p-6">
        <div className="space-y-2">
          <Label htmlFor="requester-message">Message {first}</Label>
          <textarea
            id="requester-message"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Can you confirm who's driving on Saturday and what time you'll collect?"
            className="flex w-full"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" className="gap-1.5" onClick={send} disabled={busy || !text.trim()}>
              <Send className="h-3.5 w-3.5" />
              {busy ? "Sending…" : "Send on Slack"}
            </Button>
            <span className="text-xs text-[color:var(--text-secondary)]">
              Sent as a Slack DM, with your name on it. Falls back to email if they aren&apos;t on Slack.
            </span>
          </div>
        </div>

        {rows.length > 0 && (
          <ul className="divide-y divide-rule border-t border-rule">
            {rows.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="mono-label">
                    {KIND_LABEL[r.kind] ?? r.kind}
                    {r.sender_name ? ` · ${r.sender_name}` : ""}
                  </span>
                  <span className="text-xs text-[color:var(--text-tertiary)]">
                    {when(r.created_at)} ·{" "}
                    <span className={r.via_slack || r.via_email ? "" : "text-destructive"}>{channels(r)}</span>
                  </span>
                </div>
                {r.body && <p className="mt-1 whitespace-pre-line text-sm">{r.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
