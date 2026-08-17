"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { SectionBar, StatusPill } from "@/components/ffsa";

type RegionStatus =
  | { connected: false; live?: false }
  // connected = a token exists. live = it was just verified against Xero.
  // The two come apart when authorisation lapses, which is the case that
  // previously showed a green pill and hid the fix.
  | {
      connected: true;
      live: boolean;
      tenantName: string | null;
      expiresAt: string;
      problem?: string;
    };

type XeroStatusResponse = {
  za: RegionStatus;
  us: RegionStatus;
};

const REGION_CONFIG = {
  za: { label: "South Africa", flag: "🇿🇦", currency: "ZAR" },
  us: { label: "United States", flag: "🇺🇸", currency: "USD" },
} as const;

type Region = keyof typeof REGION_CONFIG;

export function XeroConnection() {
  const [status, setStatus] = useState<XeroStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<Region | null>(null);
  const searchParams = useSearchParams();

  useEffect(() => {
    const xero = searchParams.get("xero");
    if (xero === "connected") {
      const org = searchParams.get("org");
      const region = searchParams.get("region");
      toast.success(
        `Connected to Xero${region ? ` (${region})` : ""}${org ? ` — ${org}` : ""}`
      );
    } else if (xero === "error") {
      const msg = searchParams.get("message");
      toast.error(`Xero connection failed: ${msg || "Unknown error"}`);
    }
  }, [searchParams]);

  useEffect(() => {
    fetch("/api/integrations/xero/status")
      .then((r) => r.json())
      .then((data) => setStatus(data))
      .catch(() => setStatus({ za: { connected: false }, us: { connected: false } }))
      .finally(() => setLoading(false));
  }, []);

  async function handleDisconnect(region: Region) {
    setDisconnecting(region);
    try {
      const res = await fetch("/api/integrations/xero/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region }),
      });
      if (res.ok) {
        toast.success(`Xero ${REGION_CONFIG[region].label} disconnected`);
        setStatus((prev) =>
          prev ? { ...prev, [region]: { connected: false } } : prev
        );
      } else {
        toast.error("Failed to disconnect");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setDisconnecting(null);
    }
  }

  if (loading) {
    return (
      <div className="border border-ink bg-white">
        <SectionBar title="Xero integration" />
        <div className="flex items-center justify-center gap-2 py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="mono-label">Checking Xero connections</span>
        </div>
      </div>
    );
  }

  // Counts WORKING connections. Counting token rows is what let a dead
  // connection report "2 of 2 connected".
  const liveCount = [status?.za, status?.us].filter(
    (r) => r?.connected === true && r.live === true
  ).length;

  return (
    <div className="border border-ink bg-white">
      <SectionBar title="Xero integration" meta={`${liveCount} of 2 working`} />
      <div className="p-6">
        <p className="mb-5 max-w-2xl text-[13px] text-[color:var(--text-secondary)]">
          Connect your Xero accounts to automatically create and email invoices.
          American students are invoiced through the US account (USD), all others
          through the SA account (ZAR).
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          {(["za", "us"] as const).map((region) => {
            const cfg = REGION_CONFIG[region];
            const regionStatus = status?.[region];
            const isConnected = regionStatus?.connected === true;
            // Verified against Xero just now — not merely "a token row exists".
            const isLive = isConnected && regionStatus?.live === true;

            // Connected reads as a solid hairline on bone; not-connected keeps the
            // dashed rule so an unfinished integration is legible at a glance.
            return (
              <div
                key={region}
                className={`border p-5 ${
                  isLive ? "border-rule-strong bg-bone" : "border-dashed border-rule-strong"
                }`}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="font-display text-[18px] font-black uppercase leading-none">
                    {cfg.flag} {cfg.label}
                  </span>
                  <StatusPill
                    tone={isLive ? "good" : isConnected ? "bad" : "quiet"}
                  >
                    {isLive
                      ? "Connected"
                      : isConnected
                        ? "Authorisation expired"
                        : "Not connected"}
                  </StatusPill>
                </div>

                {isLive && regionStatus.connected ? (
                  <div className="space-y-3">
                    <p className="text-[12px] text-[color:var(--text-secondary)]">
                      {regionStatus.tenantName ?? "Xero Organization"} •{" "}
                      <span className="tabular">{cfg.currency}</span>
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => handleDisconnect(region)}
                      disabled={disconnecting === region}
                    >
                      {disconnecting === region
                        ? "Disconnecting..."
                        : "Disconnect"}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {isConnected && regionStatus.connected && regionStatus.problem ? (
                      // Say what is wrong and offer the fix in one step — no
                      // disconnect-then-reconnect dance.
                      <p className="text-[12px] text-[color:var(--destructive)]">
                        {regionStatus.problem}
                      </p>
                    ) : (
                      <p className="text-[12px] text-[color:var(--text-secondary)]">
                        Invoices in <span className="tabular">{cfg.currency}</span>
                      </p>
                    )}
                    <Button asChild size="sm" className="w-full">
                      <a href={`/api/integrations/xero/connect?region=${region}`}>
                        {isConnected ? "Reconnect" : "Connect"} {cfg.label} Account
                      </a>
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
