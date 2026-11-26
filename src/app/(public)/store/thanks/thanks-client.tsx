"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "../_components/ui";

export function PendingRefresh() {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => {
      if (++n > 40) return clearInterval(t);
      router.refresh();
    }, 4000);
    return () => clearInterval(t);
  }, [router]);
  return <div className="h-1 w-full overflow-hidden bg-bone-2"><div className="h-full w-1/3 animate-pulse bg-ink" /></div>;
}

export function EftProofForm({ orderId, token }: { orderId: string; token: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    if (token) form.append("t", token);
    const res = await fetch(`/api/store/orders/${orderId}/eft-proof`, { method: "POST", body: form }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) return setError(body?.error ?? "That didn't upload. Try again.");
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <label className="inline-flex min-h-12 cursor-pointer items-center border border-ink px-5 font-mono text-[11px] font-bold uppercase tracking-[0.16em] hover:bg-bone">
        {busy ? "Uploading…" : "Upload proof of payment"}
        <input type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </label>
      <p className="text-[12px] text-[color:var(--text-tertiary)]">PDF, JPG or PNG, up to 5 MB.</p>
      {error && <Notice tone="bad">{error}</Notice>}
    </div>
  );
}
