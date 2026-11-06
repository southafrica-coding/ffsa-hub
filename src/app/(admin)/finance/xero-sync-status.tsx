"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { StatusPill } from "@/components/ffsa";
import { describeXeroFreshness, type XeroMirrorFreshness } from "@/lib/finance/xero-freshness";

type OrgLabel = { region: "za" | "us"; name: string };

/**
 * "Updated from Xero {time}" for each org, and the automatic refresh.
 *
 * On open it asks the server to sync any org whose copy is over 5 minutes
 * old (POST /api/finance/xero/sync, mode if_stale). The page shows the
 * last copy straight away and reloads its data when the sync lands; nobody
 * has to press anything. "Sync now" is a secondary shortcut for finance
 * editors who want it this second.
 */
export function XeroSyncStatus({
  orgs,
  freshness,
  canSyncNow,
}: {
  orgs: OrgLabel[];
  freshness: XeroMirrorFreshness[];
  canSyncNow: boolean;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const asked = useRef(false);

  async function sync(mode: "if_stale" | "now") {
    setSyncing(true);
    try {
      const res = await fetch("/api/finance/xero/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        results?: Array<{ status: string }>;
        error?: string;
      };
      if (!res.ok) {
        if (mode === "now") toast.error(d.error || "Could not sync from Xero");
        return;
      }
      const ran = (d.results ?? []).some((r) => !["fresh", "busy"].includes(r.status));
      if (ran) router.refresh();
      if (mode === "now" && !ran) toast.info("Already syncing — the list will update in a moment.");
    } catch {
      if (mode === "now") toast.error("Network error");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void sync("if_stale");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="border border-ink">
      {orgs.map((org, i) => {
        const line = describeXeroFreshness(freshness.find((f) => f.region === org.region));
        return (
          <div
            key={org.region}
            className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${i > 0 ? "border-t border-rule" : ""}`}
          >
            <span className="w-[110px] font-mono text-[10px] font-bold uppercase tracking-[0.14em]">
              {org.name}
            </span>
            <StatusPill tone={line.tone}>
              {line.tone === "good" ? "In step" : line.tone === "bad" ? "Problem" : line.tone === "warn" ? "Check" : "Waiting"}
            </StatusPill>
            <span className="text-[13px] text-[color:var(--text-secondary)]">{line.text}</span>
          </div>
        );
      })}
      {(syncing || canSyncNow) && (
        <div className="flex items-center justify-between gap-3 border-t border-rule px-4 py-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--text-tertiary)]">
            {syncing ? "Checking Xero for changes…" : "Kept in step with Xero automatically"}
          </span>
          {canSyncNow && (
            <button
              type="button"
              onClick={() => sync("now")}
              disabled={syncing}
              className="border border-ink px-3 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] disabled:opacity-50"
            >
              Sync now
            </button>
          )}
        </div>
      )}
    </div>
  );
}
