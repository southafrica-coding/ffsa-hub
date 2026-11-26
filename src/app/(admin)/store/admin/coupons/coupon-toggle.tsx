"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

/** Turn a code on or off without opening the form. */
export function CouponToggle({ id, code, active }: { id: string; code: string; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function flip() {
    setBusy(true);
    const res = await fetch(`/api/store/admin/coupons/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !active }),
    }).catch(() => null);
    const out = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) return toast.error(out?.error ?? "Didn't save");
    toast.success(active ? `${code} is off` : `${code} is on`);
    router.refresh();
  }

  return (
    <button
      type="button"
      aria-label={`Turn ${code} ${active ? "off" : "on"}`}
      disabled={busy}
      onClick={flip}
      className="inline-flex min-h-11 items-center gap-2 border border-ink px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] transition-colors hover:bg-bone disabled:opacity-50"
    >
      <span aria-hidden className={`h-2.5 w-2.5 border border-ink ${active ? "bg-ink" : "bg-white"}`} />
      {busy ? "Saving…" : active ? "Turn off" : "Turn on"}
    </button>
  );
}
