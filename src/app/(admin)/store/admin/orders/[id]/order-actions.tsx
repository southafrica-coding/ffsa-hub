"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionBar } from "@/components/ffsa";

const STEP_LABEL: Record<string, string> = {
  to_pack: "Move to packing",
  ready_to_collect: "Mark ready for collection",
  collected: "Mark collected",
};

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
      <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:flex-wrap sm:items-end md:px-8">
        {hasProof && (
          <a href={`/api/store/admin/orders/${orderId}/eft-proof`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center border border-ink px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] hover:bg-bone">
            Open proof of payment
          </a>
        )}
        {canMarkPaid && (
          <Button className="min-h-11 w-full sm:w-auto" disabled={!!busy} onClick={() => call("paid", `/api/store/admin/orders/${orderId}/mark-paid`, undefined, "Has this EFT reflected in the bank? Marking it paid gives the buyer access and emails them.")}>
            {busy === "paid" ? "Marking…" : "Mark EFT paid"}
          </Button>
        )}
        {fulfilment && fulfilment.next.length > 0 && (
          <>
            {fulfilment.method === "delivery" && fulfilment.next.some((n) => n.id === "shipped") && (
              <div>
                <span className="mono-label mb-1 block">Tracking (optional)</span>
                <Input value={tracking} onChange={(e) => setTracking(e.target.value)} className="h-10 w-full sm:w-56" />
              </div>
            )}
            {fulfilment.next.map((n) => (
              <Button
                key={n.id}
                variant={n.id === "ready_to_collect" ? "default" : "outline"}
                className="min-h-11 w-full sm:w-auto"
                disabled={!!busy}
                onClick={() =>
                  call(
                    n.id,
                    `/api/store/admin/orders/${orderId}/fulfilment`,
                    { status: n.id, tracking: tracking || null },
                    n.id === "ready_to_collect" ? "Is it packed and at reception? The buyer gets an email saying it's ready to collect." : undefined
                  )
                }
              >
                {busy === n.id ? "Saving…" : STEP_LABEL[n.id] ?? `Mark: ${n.label}`}
              </Button>
            ))}
          </>
        )}
        {canCancel && (
          <Button variant="ghost" className="min-h-11 w-full sm:w-auto" disabled={!!busy} onClick={() => call("cancel", `/api/store/admin/orders/${orderId}/cancel`, undefined, "Cancel this unpaid order?")}>
            Cancel order
          </Button>
        )}
      </div>
    </>
  );
}
