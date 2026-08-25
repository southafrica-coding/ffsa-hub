"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// Per-module mute toggles, rendered straight off the BROADCAST_TYPES
// registry — declaring a new broadcast type makes it mutable here
// without touching this file.
//
// These only ever silence. There is no subscribe, because recipients
// are derived from what a broadcast is and who you are, so there's
// nothing for a preference to fall out of sync with.

type ModuleRow = {
  key: string;
  label: string;
  description: string;
  types: Array<{ key: string; label: string; description: string }>;
};

export function NotificationPrefsCard({
  modules,
  mutedModules,
  slackConnected,
}: {
  modules: ModuleRow[];
  mutedModules: string[];
  slackConnected: boolean;
}) {
  const [muted, setMuted] = useState<string[]>(mutedModules);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function toggle(moduleKey: string) {
    const next = muted.includes(moduleKey)
      ? muted.filter((m) => m !== moduleKey)
      : [...muted, moduleKey];

    // Optimistic: the toggle should feel instant, and a failure puts
    // it straight back rather than leaving the UI lying.
    const previous = muted;
    setMuted(next);
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch("/api/profile/notification-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mutedModules: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMuted(previous);
        setError(data.error || "Couldn't save. Please try again.");
        return;
      }
      setSaved(true);
    } catch {
      setMuted(previous);
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (modules.length === 0) return null;

  return (
    <div className="rounded-xl border bg-muted/40 p-4 text-sm">
      <p className="font-medium">What the Hub messages you about</p>
      <p className="mt-1 text-muted-foreground">
        Everything is on by default. Turn an area off if it isn&rsquo;t useful
        to you &mdash; you can turn it back on any time.
      </p>

      {!slackConnected && (
        <p className="mt-2 text-muted-foreground">
          These take effect once you connect Slack above.
        </p>
      )}
      {error && <p className="mt-2 text-destructive">{error}</p>}
      {saved && !error && (
        <p className="mt-2 text-muted-foreground">Saved.</p>
      )}

      <ul className="mt-3 space-y-3">
        {modules.map((mod) => {
          const isMuted = muted.includes(mod.key);
          return (
            <li
              key={mod.key}
              className="flex items-start justify-between gap-4 rounded-lg border bg-background p-3"
            >
              <div>
                <p className="font-medium">{mod.label}</p>
                <p className="mt-0.5 text-muted-foreground">
                  {mod.description}
                </p>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                  {mod.types.map((t) => (
                    <li key={t.key}>{t.description}</li>
                  ))}
                </ul>
              </div>
              <Button
                variant={isMuted ? "outline" : "default"}
                size="sm"
                onClick={() => toggle(mod.key)}
                disabled={saving}
                className="shrink-0"
              >
                {isMuted ? "Off" : "On"}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
