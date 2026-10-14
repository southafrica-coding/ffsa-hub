"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";

// Pull the latest school-fee payments from Xero now, instead of waiting for
// the webhook or the daily catch-up.
export function RefreshPaymentsButton({ programId }: { programId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      const res = await fetch("/api/finance/school-fees/sync-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId }),
      });
      const j = await res.json();
      if (!res.ok) {
        toast.error(j.error || "Couldn't reach Xero");
        return;
      }
      if (j.errors?.length) toast.error(j.errors[0]);
      else
        toast.success(
          j.chargesUpdated > 0
            ? `Updated ${j.chargesUpdated} charge${j.chargesUpdated === 1 ? "" : "s"} from Xero`
            : `Up to date with Xero (${j.invoicesChecked} invoice${j.invoicesChecked === 1 ? "" : "s"} checked)`
        );
      if (j.voided?.length) {
        toast.warning(
          `${j.voided.length} invoice${j.voided.length === 1 ? " was" : "s were"} voided in Xero but still expected here: ${j.voided
            .map((v: { invoiceNumber: string | null }) => v.invoiceNumber ?? "?")
            .join(", ")}`
        );
      }
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={refresh}
      disabled={busy}
      className="inline-flex shrink-0 items-center gap-1.5 border border-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
      Refresh from Xero
    </button>
  );
}
