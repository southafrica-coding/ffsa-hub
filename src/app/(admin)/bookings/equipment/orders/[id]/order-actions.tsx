"use client";

// Approve / Decline a ministry request (frame 47d phone), and apply an
// extension a customer asked for. A sticky bar on a phone.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { dayLabel } from "@/lib/equipment/dates";

export function OrderActions({
  orderId,
  status,
  pendingExtension,
}: {
  orderId: string;
  status: string;
  pendingExtension: string | null;
}) {
  const router = useRouter();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(body: Record<string, unknown>) {
    setBusy(String(body.action));
    setError(null);
    const res = await fetch(`/api/equipment/orders/${orderId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(json.error ?? "That didn't go through.");
      return;
    }
    setDeclining(false);
    router.refresh();
  }

  const requested = status === "requested";
  if (!requested && !pendingExtension) return null;

  return (
    <div className="sticky bottom-[72px] z-10 border-t border-[color:var(--hire-line)] bg-[color:var(--hire-surface)] px-[18px] py-3 md:bottom-0 md:px-9">
      {error && <p className="mb-2 text-[14px] text-[color:var(--hire-accent)]">{error}</p>}
      {pendingExtension && !requested && (
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <span className="text-[14px] text-[color:var(--hire-ink)]">They asked to keep it until {dayLabel(pendingExtension)}.</span>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => act({ action: "extend", newEnd: pendingExtension })}
            className="flex h-[50px] items-center justify-center rounded-[8px] bg-[color:var(--hire-accent)] px-5 font-bold text-[color:var(--hire-on-accent)]"
          >
            {busy === "extend" ? <Loader2 className="h-4 w-4 animate-spin" /> : `Extend to ${dayLabel(pendingExtension)}`}
          </button>
        </div>
      )}
      {requested && declining && (
        <div className="mb-2.5">
          <label>
            <span className="hire-label mb-1.5 block">Why not? They&apos;ll see this.</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full px-3.5 py-3" />
          </label>
        </div>
      )}
      {requested && (
        <div className="grid grid-cols-2 gap-2.5 md:flex md:justify-end">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => (declining ? act({ action: "decline", reason }) : setDeclining(true))}
            className="flex h-[54px] items-center justify-center rounded-[8px] border border-[color:var(--hire-line-strong)] px-6 text-[16px] text-[color:var(--hire-ink)] md:h-11"
          >
            {busy === "decline" ? <Loader2 className="h-4 w-4 animate-spin" /> : declining ? "Send decline" : "Decline"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => act({ action: "approve" })}
            className="flex h-[54px] items-center justify-center rounded-[8px] bg-[color:var(--hire-accent)] px-6 text-[16px] font-bold text-[color:var(--hire-on-accent)] md:h-11"
          >
            {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve"}
          </button>
        </div>
      )}
    </div>
  );
}
