"use client";

import { useState } from "react";
import { retryXeroMessage, type ConfirmedReceiptDraft } from "@/lib/finance/receipt-xero-retry";

/**
 * Retries POST /api/finance/outreach/receipts/xero for a receipt that is
 * already confirmed. Finance editors only. The route is idempotent: a
 * second try does not create a second spend.
 */
export function ConfirmedReceipts({
  drafts,
  canRetry,
}: {
  drafts: ConfirmedReceiptDraft[];
  canRetry: boolean;
}) {
  if (drafts.length === 0) return null;
  return (
    <div className="border border-ink">
      <div className="section-bar">
        <span className="section-bar-title">Confirmed receipts</span>
        <span className="section-bar-meta">{drafts.length} logged</span>
      </div>
      <p className="border-b border-rule px-4 py-3 text-[13px] leading-snug">
        These were confirmed in Slack. Trying Xero again sends the same receipt. If Xero already has it, this does
        not add a second spend.
      </p>
      <ul>
        {drafts.map((draft) => (
          <li key={draft.id} className="flex flex-col gap-2 border-b border-rule px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm">{draft.label}</div>
              <div className="mono-label mt-1 truncate">{draft.fileName}</div>
            </div>
            {canRetry ? <RetryButton draftId={draft.id} /> : <span className="mono-label">Finance sends this to Xero</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RetryButton({ draftId }: { draftId: string }) {
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function retry() {
    setPending(true);
    setNote(null);
    try {
      const res = await fetch("/api/finance/outreach/receipts/xero", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId }),
      });
      const body = await res.json().catch(() => ({}));
      setNote(retryXeroMessage(res.status, body));
    } catch {
      setNote("Couldn't reach the Hub. Nothing was sent.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={retry}
        disabled={pending}
        className="inline-flex min-h-11 items-center border border-ink bg-ink px-3 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white disabled:opacity-60"
      >
        {pending ? "Sending…" : "Try Xero again"}
      </button>
      {note && <p className="max-w-sm text-[12px] leading-snug text-[color:var(--text-secondary)]">{note}</p>}
    </div>
  );
}
