"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Send, Slack } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SectionBar } from "@/components/ffsa";
import type { ConversationLine, RequesterMessageRow } from "@/lib/vehicles/requester-notify";

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

const CONNECT_RESULT: Record<string, [ok: boolean, text: string]> = {
  connected: [true, "Slack connected — your messages now come from you."],
  cancelled: [false, "Slack connection cancelled."],
  wrong_account: [false, "That Slack account isn't the one linked to your Hub profile."],
  taken: [false, "That Slack account is already linked to another Hub user."],
  state_mismatch: [false, "The Slack sign-in expired — please try again."],
  failed: [false, "Couldn't connect Slack — please try again."],
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
 * Talk to the person who booked. Messages go from the manager's OWN Slack
 * account (connected once), so the requester simply replies in that DM — and
 * the DM is read back here so the whole conversation sits on the booking.
 * Below it, the log of automatic updates the requester has been sent.
 */
export function RequesterMessages({
  bookingId,
  requesterName,
  rows,
  conversation,
  slackConnected,
}: {
  bookingId: string;
  requesterName: string | null;
  rows: RequesterMessageRow[];
  conversation: ConversationLine[];
  slackConnected: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(slackConnected);

  const connectHref = `/api/slack/user-oauth?next=${encodeURIComponent(`/bookings/vehicles/${bookingId}`)}`;

  // Coming back from Slack's consent screen.
  useEffect(() => {
    const result = params.get("slack");
    if (!result) return;
    const [ok, msg] = CONNECT_RESULT[result] ?? CONNECT_RESULT.failed;
    if (ok) toast.success(msg);
    else toast.error(msg);
    router.replace(`/bookings/vehicles/${bookingId}`, { scroll: false });
  }, [params, router, bookingId]);

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
        if (json.needsConnect) setConnected(false);
        toast.error(json.error ?? "Could not send.");
        return;
      }
      toast.success(
        json.via === "slack"
          ? "Sent from your Slack — their reply comes straight to you."
          : "They aren't on Slack — sent by email instead."
      );
      setText("");
      router.refresh();
    } catch {
      toast.error("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  const first = (requesterName ?? "").trim().split(/\s+/)[0] || "the requester";
  // Messages sent as the manager show in the conversation instead.
  const updates = rows.filter((r) => !(r.kind === "message" && r.sent_as_user));

  return (
    <div className="border border-ink bg-white">
      <SectionBar title={`Conversation with ${first}`} />
      <div className="space-y-5 p-6">
        {!connected && (
          <div className="flex flex-wrap items-center justify-between gap-3 border border-rule bg-bone p-4">
            <p className="text-sm">
              Connect your Slack once so messages to {first} come from <em>you</em> — they reply straight to
              you in Slack, and the chat shows up here.
            </p>
            <a
              href={connectHref}
              className="inline-flex items-center gap-1.5 border border-ink bg-ink px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white"
            >
              <Slack className="h-4 w-4" />
              Connect my Slack
            </a>
          </div>
        )}

        {conversation.length > 0 && (
          <ul className="max-h-96 space-y-2 overflow-y-auto border border-rule p-3">
            {conversation.map((m) => (
              <li key={m.ts} className={m.fromRequester ? "flex justify-start" : "flex justify-end"}>
                <div
                  className={
                    "max-w-[80%] px-3 py-2 text-sm " +
                    (m.fromRequester ? "border border-rule bg-bone" : "border border-ink bg-white")
                  }
                >
                  <p className="mono-label mb-0.5">
                    {m.who} · {when(m.at)}
                  </p>
                  <p className="whitespace-pre-line">{m.text}</p>
                </div>
              </li>
            ))}
          </ul>
        )}

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
            <Button size="sm" className="gap-1.5" onClick={send} disabled={busy || !text.trim() || !connected}>
              <Send className="h-3.5 w-3.5" />
              {busy ? "Sending…" : "Send from my Slack"}
            </Button>
            <span className="text-xs text-[color:var(--text-secondary)]">
              Arrives as a normal DM from you. Replies come to you in Slack and appear here. Email if they
              aren&apos;t on Slack.
            </span>
          </div>
        </div>

        {updates.length > 0 && (
          <div>
            <p className="mono-label mb-1">Updates sent</p>
            <ul className="divide-y divide-rule border-t border-rule">
              {updates.map((r) => (
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
          </div>
        )}
      </div>
    </div>
  );
}
