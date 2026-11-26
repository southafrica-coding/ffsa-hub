"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionBar } from "@/components/ffsa";

export function OrderActions({
  orderId,
  canMarkPaid,
  canCancel,
  hasProof,
  fulfilment,
}: {
  orderId: string;
  canMarkPaid: boolean;
  canCancel: boolean;
  hasProof: boolean;
  fulfilment: { method: "delivery" | "collect"; next: Array<{ id: string; label: string }> } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [tracking, setTracking] = useState("");

  async function call(key: string, url: string, body?: unknown, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(key);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
    const out = await res?.json().catch(() => ({}));
    setBusy(null);
    if (!res?.ok) return toast.error(out?.error ?? "That didn't work");
    toast.success("Done");
    router.refresh();
  }

  const nothing = !canMarkPaid && !canCancel && !(fulfilment && fulfilment.next.length);
  if (nothing && !hasProof) return null;

  return (
    <>
      <SectionBar title="Actions" />
      <div className="flex flex-wrap items-end gap-3 px-5 py-5 md:px-8">
        {hasProof && (
          <a href={`/api/store/admin/orders/${orderId}/eft-proof`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center border border-ink px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] hover:bg-bone">
            Open proof of payment
          </a>
        )}
        {canMarkPaid && (
          <Button disabled={!!busy} onClick={() => call("paid", `/api/store/admin/orders/${orderId}/mark-paid`, undefined, "Has this EFT reflected in the bank? Marking it paid gives the buyer access and emails them.")}>
            {busy === "paid" ? "Marking…" : "Mark EFT paid"}
          </Button>
        )}
        {fulfilment && fulfilment.next.length > 0 && (
          <>
            {fulfilment.method === "delivery" && fulfilment.next.some((n) => n.id === "shipped") && (
              <div>
                <span className="mono-label mb-1 block">Tracking (optional)</span>
                <Input value={tracking} onChange={(e) => setTracking(e.target.value)} className="h-10 w-56" />
              </div>
            )}
            {fulfilment.next.map((n) => (
              <Button key={n.id} variant="outline" disabled={!!busy} onClick={() => call(n.id, `/api/store/admin/orders/${orderId}/fulfilment`, { status: n.id, tracking: tracking || null })}>
                {busy === n.id ? "Saving…" : `Mark: ${n.label}`}
              </Button>
            ))}
          </>
        )}
        {canCancel && (
          <Button variant="ghost" disabled={!!busy} onClick={() => call("cancel", `/api/store/admin/orders/${orderId}/cancel`, undefined, "Cancel this unpaid order?")}>
            Cancel order
          </Button>
        )}
      </div>
    </>
  );
}
