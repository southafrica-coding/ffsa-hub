"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FileDown, WifiOff } from "lucide-react";
import { Flipbook, type FlipPage } from "../../_components/flipbook";
import { getDeviceId, registerOfflineReader } from "../../_components/device";
import { Notice } from "../../_components/ui";

type State =
  | { kind: "loading" }
  | { kind: "ready"; pages: FlipPage[]; pdf: boolean; downloadsLeft: number }
  | { kind: "device-limit"; message: string }
  | { kind: "error"; message: string };

export function Reader({ productId }: { productId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [offline, setOffline] = useState(false);
  const [musicUrl, setMusicUrl] = useState<string | null>(null);

  // Optional background music: a short-lived signed link, asked for again when it fails (expired).
  const loadMusic = useCallback(async () => {
    try {
      const res = await fetch(`/api/store/library/${productId}/audio`, { headers: { "x-store-device": getDeviceId() } });
      const body = await res.json().catch(() => ({}));
      setMusicUrl(res.ok && typeof body.url === "string" ? body.url : null);
    } catch {
      setMusicUrl(null);
    }
  }, [productId]);

  const load = useCallback(async () => {
    try {
      const deviceId = getDeviceId();
      const reg = await fetch("/api/store/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId }) }).catch(() => null);
      if (reg && reg.status === 409) {
        const body = await reg.json().catch(() => ({}));
        return setState({ kind: "device-limit", message: body.error ?? "You're reading on too many devices." });
      }
      const res = await fetch(`/api/store/library/${productId}/pages`, { headers: { "x-store-device": deviceId } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setState({ kind: "error", message: body.error ?? "This won't open right now. Try again." });
      setState({ kind: "ready", pages: body.pages, pdf: !!body.pdf, downloadsLeft: typeof body.downloadsLeft === "number" ? body.downloadsLeft : 0 });
      loadMusic();
    } catch {
      setState({ kind: "error", message: "You're offline and this hasn't been opened on this device yet." });
    }
  }, [productId, loadMusic]);

  useEffect(() => {
    registerOfflineReader();
    load();
    const on = () => setOffline(!navigator.onLine);
    on();
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, [load]);

  if (state.kind === "loading") return <div className="aspect-[3/4] w-full animate-pulse bg-bone-2 md:aspect-[16/10]" />;
  if (state.kind === "device-limit") {
    return (
      <div className="space-y-4 px-4 py-10 md:px-8">
        <Notice tone="bad">{state.message}</Notice>
        <Link href="/store/library/devices" className="inline-flex min-h-12 items-center border border-ink bg-ink px-5 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-white hover:bg-[var(--ink-bg-hover)]">
          Manage devices
        </Link>
      </div>
    );
  }
  if (state.kind === "error") return <div className="px-4 py-10 md:px-8"><Notice tone="bad">{state.message}</Notice></div>;

  return (
    <>
      {offline && (
        <div className="flex items-center gap-2 border-b border-rule bg-bone px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] md:px-8">
          <WifiOff className="h-3.5 w-3.5" /> Offline · pages you&apos;ve opened before still work
        </div>
      )}
      <Flipbook
        pages={state.pages}
        onNeedRefresh={() => !offline && load()}
        musicUrl={musicUrl}
        onMusicExpired={() => !offline && loadMusic()}
        footer={
          state.pdf ? (
            <span className="flex min-w-0 flex-col items-end leading-tight" data-pdf-downloads={state.downloadsLeft}>
              {state.downloadsLeft > 0 ? (
                <a
                  href={`/api/store/library/${productId}/pdf`}
                  // One download used per click: refresh the count once it's been taken.
                  onClick={() => setTimeout(() => setState((s) => (s.kind === "ready" ? { ...s, downloadsLeft: Math.max(0, s.downloadsLeft - 1) } : s)), 0)}
                  className="inline-flex min-h-7 items-center gap-1.5 whitespace-nowrap text-ink underline decoration-yellow decoration-2 underline-offset-4"
                >
                  <FileDown className="h-3.5 w-3.5" /> Your PDF
                </a>
              ) : (
                <span className="inline-flex min-h-7 items-center gap-1.5 whitespace-nowrap text-[color:var(--text-quiet)]" aria-disabled="true" title="You can still read it here">
                  <FileDown className="h-3.5 w-3.5" /> Your PDF
                </span>
              )}
              <span className="whitespace-nowrap text-[9px] tabular-nums text-[color:var(--text-tertiary)]">Downloads left: {state.downloadsLeft}</span>
            </span>
          ) : undefined
        }
      />
    </>
  );
}
