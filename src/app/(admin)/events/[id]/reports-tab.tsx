"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Subscription = {
  enabled: boolean;
  email_enabled: boolean;
  whatsapp_enabled: boolean;
  cadence: string;
  weekly_weekday: number;
  send_hour_utc: number;
  dest_email: string | null;
  dest_whatsapp: string | null;
  last_sent_at: string | null;
  last_status: string | null;
};

type ChannelOutcome = { status: "sent" | "skipped" | "error"; detail?: string };

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function hourLabel(h: number): string {
  const sast = (h + 2) % 24; // SAST = UTC+2
  return `${pad(h)}:00 UTC · ${pad(sast)}:00 SAST`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function ReportsTab({ eventId }: { eventId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [exists, setExists] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{
    email: ChannelOutcome;
    whatsapp: ChannelOutcome;
  } | null>(null);

  const [sub, setSub] = useState<Subscription>({
    enabled: false,
    email_enabled: true,
    whatsapp_enabled: false,
    cadence: "daily",
    weekly_weekday: 1,
    send_hour_utc: 6,
    dest_email: "",
    dest_whatsapp: "",
    last_sent_at: null,
    last_status: null,
  });

  const set = useCallback(<K extends keyof Subscription>(
    key: K,
    value: Subscription[K]
  ) => {
    setSub((s) => ({ ...s, [key]: value }));
    setSavedAt(null);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/events/${eventId}/report-subscription`);
        if (!res.ok) throw new Error("Failed to load preferences");
        const data = await res.json();
        if (!active) return;
        setExists(Boolean(data.exists));
        setSub({
          ...data.subscription,
          dest_email: data.subscription.dest_email ?? "",
          dest_whatsapp: data.subscription.dest_whatsapp ?? "",
        });
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [eventId]);

  async function save() {
    setSaving(true);
    setError(null);
    setTestResult(null);
    try {
      const res = await fetch(`/api/events/${eventId}/report-subscription`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setExists(true);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const res = await fetch(
        `/api/events/${eventId}/report-subscription/test`,
        { method: "POST" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Test failed");
      setTestResult({ email: data.email, whatsapp: data.whatsapp });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Loading your report preferences…
      </p>
    );
  }

  const noChannel = !sub.email_enabled && !sub.whatsapp_enabled;

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Analytics updates</CardTitle>
          <p className="text-sm text-muted-foreground">
            Get this event&apos;s ticketing numbers sent to you automatically —
            by email, WhatsApp, or both, on the cadence you choose. Settings are
            personal to you; other staff on this event set their own.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Master toggle */}
          <label className="flex items-start gap-3 cursor-pointer">
            <Checkbox
              checked={sub.enabled}
              onCheckedChange={(v) => set("enabled", Boolean(v))}
              className="mt-0.5"
            />
            <span>
              <span className="text-sm font-medium">
                Send me recurring updates for this event
              </span>
              <span className="block text-xs text-muted-foreground">
                Uncheck to pause without losing your settings.
              </span>
            </span>
          </label>

          <fieldset
            className="space-y-5 border-t pt-5"
            disabled={!sub.enabled}
            style={{ opacity: sub.enabled ? 1 : 0.55 }}
          >
            {/* Channels */}
            <div className="space-y-3">
              <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                Channels
              </Label>

              <label className="flex items-center gap-3 cursor-pointer">
                <Checkbox
                  checked={sub.email_enabled}
                  onCheckedChange={(v) => set("email_enabled", Boolean(v))}
                />
                <span className="text-sm">Email</span>
              </label>
              {sub.email_enabled && (
                <Input
                  type="email"
                  value={sub.dest_email ?? ""}
                  onChange={(e) => set("dest_email", e.target.value)}
                  placeholder="you@example.com"
                  className="ml-7 max-w-sm"
                />
              )}

              <label className="flex items-center gap-3 cursor-pointer">
                <Checkbox
                  checked={sub.whatsapp_enabled}
                  onCheckedChange={(v) => set("whatsapp_enabled", Boolean(v))}
                />
                <span className="text-sm">WhatsApp</span>
              </label>
              {sub.whatsapp_enabled && (
                <div className="ml-7 max-w-sm space-y-1">
                  <Input
                    type="tel"
                    value={sub.dest_whatsapp ?? ""}
                    onChange={(e) => set("dest_whatsapp", e.target.value)}
                    placeholder="+27821234567"
                  />
                  <p className="text-xs text-muted-foreground">
                    International format (e.g. +27 for South Africa). WhatsApp
                    delivery goes live once the org&apos;s Twilio sender is
                    approved — until then it&apos;s saved and shows as
                    &ldquo;pending&rdquo;.
                  </p>
                </div>
              )}

              {noChannel && (
                <p className="text-xs text-red-600">
                  Choose at least one channel.
                </p>
              )}
            </div>

            {/* Cadence */}
            <div className="space-y-3 border-t pt-5">
              <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                How often
              </Label>
              <div className="flex gap-2">
                {(["daily", "weekly"] as const).map((c) => (
                  <Button
                    key={c}
                    type="button"
                    variant={sub.cadence === c ? "default" : "outline"}
                    size="sm"
                    onClick={() => set("cadence", c)}
                    className="capitalize"
                  >
                    {c}
                  </Button>
                ))}
              </div>

              {sub.cadence === "weekly" && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Day of week
                  </Label>
                  <Select
                    value={String(sub.weekly_weekday)}
                    onValueChange={(v) => set("weekly_weekday", Number(v))}
                  >
                    <SelectTrigger className="max-w-[200px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAYS.map((d, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Send time */}
            <div className="space-y-1 border-t pt-5">
              <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                Time of day
              </Label>
              <Select
                value={String(sub.send_hour_utc)}
                onValueChange={(v) => set("send_hour_utc", Number(v))}
              >
                <SelectTrigger className="max-w-[260px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, h) => (
                    <SelectItem key={h} value={String(h)}>
                      {hourLabel(h)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </fieldset>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3 border-t pt-5">
            <Button type="button" onClick={save} disabled={saving || noChannel}>
              {saving ? "Saving…" : "Save preferences"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={sendTest}
              disabled={testing || !exists}
              title={
                !exists
                  ? "Save your preferences first"
                  : "Send a test digest to your channels now"
              }
            >
              {testing ? "Sending…" : "Send test now"}
            </Button>
            {savedAt !== null && (
              <span className="text-xs text-green-600">Saved</span>
            )}
            {!exists && (
              <span className="text-xs text-muted-foreground">
                Save to enable a test send.
              </span>
            )}
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          {testResult && (
            <div className="rounded-md border p-3 text-xs space-y-1">
              <p className="font-medium">Test send</p>
              <ChannelLine label="Email" outcome={testResult.email} />
              <ChannelLine label="WhatsApp" outcome={testResult.whatsapp} />
            </div>
          )}

          {/* Status */}
          {(sub.last_sent_at || sub.last_status) && (
            <p className="text-xs text-muted-foreground border-t pt-4">
              Last sent {relativeTime(sub.last_sent_at)}
              {sub.last_status ? ` — ${sub.last_status}` : ""}.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ChannelLine({
  label,
  outcome,
}: {
  label: string;
  outcome: ChannelOutcome;
}) {
  const color =
    outcome.status === "sent"
      ? "text-green-600"
      : outcome.status === "error"
        ? "text-red-600"
        : "text-muted-foreground";
  const text =
    outcome.status === "sent"
      ? "sent"
      : outcome.status === "skipped"
        ? outcome.detail === "disabled"
          ? "not enabled"
          : `pending (${outcome.detail ?? "not configured"})`
        : `failed (${outcome.detail ?? "error"})`;
  return (
    <p className={color}>
      <span className="text-foreground">{label}:</span> {text}
    </p>
  );
}
