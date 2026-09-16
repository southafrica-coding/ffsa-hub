"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { SectionBar, StatusPill } from "@/components/ffsa";

type CalendarStatus = {
  connected: boolean;
  connectedAt: string | null;
};

export function GoogleCalendarConnection() {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const searchParams = useSearchParams();

  useEffect(() => {
    const gcal = searchParams.get("gcal");
    if (gcal === "connected") {
      toast.success("Google Calendar connected — staff will be auto-shared on onboarding");
    } else if (gcal === "error") {
      const msg = searchParams.get("message");
      toast.error(`Google Calendar connection failed: ${msg || "Unknown error"}`);
    }
  }, [searchParams]);

  useEffect(() => {
    fetch("/api/integrations/google-calendar/status")
      .then((r) => r.json())
      .then((data) => setStatus(data))
      .catch(() => setStatus({ connected: false, connectedAt: null }))
      .finally(() => setLoading(false));
  }, []);

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/integrations/google-calendar/disconnect", {
        method: "POST",
      });
      if (res.ok) {
        toast.success("Google Calendar disconnected");
        setStatus({ connected: false, connectedAt: null });
      } else {
        toast.error("Failed to disconnect");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading) {
    return (
      <div className="border border-ink bg-white">
        <SectionBar title="Google Calendar" />
        <div className="flex items-center justify-center gap-2 py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="mono-label">Checking connection</span>
        </div>
      </div>
    );
  }

  const isConnected = status?.connected === true;

  return (
    <div className="border border-ink bg-white">
      <SectionBar
        title="Google Calendar"
        meta={isConnected ? "Active" : "Not connected"}
      />
      <div className="p-6">
        <p className="mb-5 max-w-2xl text-[13px] text-[color:var(--text-secondary)]">
          Connect the FFSA base Google Calendar. Once connected, staff who complete onboarding
          will automatically be given read access — the calendar appears in their own Google
          Calendar app without any action required on their part.
        </p>

        <div
          className={`max-w-sm border p-5 ${
            isConnected
              ? "border-rule-strong bg-bone"
              : "border-dashed border-rule-strong"
          }`}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="font-display text-[18px] font-black uppercase leading-none">
              Base Calendar
            </span>
            <StatusPill tone={isConnected ? "good" : "quiet"}>
              {isConnected ? "Connected" : "Not connected"}
            </StatusPill>
          </div>

          {isConnected ? (
            <div className="space-y-3">
              <p className="text-[12px] text-[color:var(--text-secondary)]">
                Staff are automatically added as viewers on onboarding
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleDisconnect}
                disabled={disconnecting}
              >
                {disconnecting ? "Disconnecting..." : "Disconnect"}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[12px] text-[color:var(--text-secondary)]">
                Sign in with the Google account that owns the FFSA base calendar
              </p>
              <Button asChild size="sm" className="w-full">
                <a href="/api/integrations/google-calendar/connect">
                  Connect Google Account
                </a>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
