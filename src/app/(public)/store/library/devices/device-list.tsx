"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clearOfflineCopies } from "../../_components/device";
import { Notice } from "../../_components/ui";

export function DeviceList({ devices, limit }: { devices: Array<{ id: string; label: string; lastSeen: string }>; limit: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/store/devices/${id}`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return setError("That didn't work. Try again.");
    router.refresh();
  }

  return (
    <div className="mt-6 max-w-[640px]">
      <div className="section-bar">
        <span className="section-bar-title">Reading devices</span>
        <span className="section-bar-meta">{devices.length} OF {limit}</span>
      </div>
      {devices.length === 0 ? (
        <p className="border-x border-b border-rule px-4 py-6 text-[14px] text-[color:var(--text-secondary)]">None yet. Open something in your library and this device is added.</p>
      ) : (
        <ul className="border-x border-rule">
          {devices.map((d) => (
            <li key={d.id} className="flex min-h-16 items-center justify-between gap-3 border-b border-rule px-4 py-3">
              <div className="min-w-0">
                <p className="font-semibold">{d.label}</p>
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-tertiary)]">
                  Last read {new Date(d.lastSeen).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(d.id)}
                disabled={busy === d.id}
                className="inline-flex min-h-11 shrink-0 items-center border border-ink px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] hover:bg-bone disabled:opacity-50"
              >
                {busy === d.id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <div className="mt-3"><Notice tone="bad">{error}</Notice></div>}
      <div className="mt-8 border-t border-rule pt-5">
        <p className="text-[13px] text-[color:var(--text-secondary)]">Shared computer? Clear the pages kept on this one for offline reading.</p>
        <button
          type="button"
          onClick={async () => {
            await clearOfflineCopies();
            setCleared(true);
          }}
          className="mt-3 inline-flex min-h-11 items-center border border-ink px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] hover:bg-bone"
        >
          {cleared ? "Cleared" : "Clear offline copies"}
        </button>
      </div>
    </div>
  );
}
