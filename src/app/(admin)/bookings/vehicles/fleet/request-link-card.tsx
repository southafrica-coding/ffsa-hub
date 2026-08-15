"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, RefreshCw, Check } from "lucide-react";
import { SectionBar } from "@/components/ffsa";

type LinkSettings = {
  slug: string;
  enabled: boolean;
  intro_note: string | null;
  updated_at: string | null;
};

// Manager control for the public "Request a vehicle" link. Mirrors the
// signup-code widget: copy URL, enable/disable, regenerate (rotates the slug),
// optional intro note shown atop the public form.
export function RequestLinkCard() {
  const [settings, setSettings] = useState<LinkSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    (async () => {
      try {
        const res = await fetch("/api/vehicles/request-link");
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setLoadError(json.error ?? "Could not load the link settings.");
          return;
        }
        setSettings(json as LinkSettings);
        setNote((json as LinkSettings).intro_note ?? "");
      } catch {
        setLoadError("Could not load the link settings.");
      }
    })();
  }, []);

  const url = settings ? `${origin}/request-vehicle/${settings.slug}` : "";

  async function patch(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const res = await fetch("/api/vehicles/request-link", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not save.");
        return;
      }
      setSettings(json as LinkSettings);
      return json as LinkSettings;
    } finally {
      setBusy(null);
    }
  }

  async function toggleEnabled() {
    if (!settings) return;
    const next = !settings.enabled;
    const saved = await patch({ enabled: next }, "toggle");
    if (saved) toast.success(next ? "Public link is live." : "Public link turned off.");
  }

  async function saveNote() {
    const saved = await patch({ intro_note: note }, "note");
    if (saved) toast.success("Intro note saved.");
  }

  async function regenerate() {
    if (
      !window.confirm(
        "Regenerate the link? The current link will stop working immediately and anyone who has it will need the new one."
      )
    )
      return;
    setBusy("regen");
    try {
      const res = await fetch("/api/vehicles/request-link/regenerate", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not regenerate the link.");
        return;
      }
      setSettings(json as LinkSettings);
      toast.success("New link generated.");
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy — select and copy the link manually.");
    }
  }

  return (
    <div className="border border-ink bg-white">
      <SectionBar title="Public request link" />
      <div className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-[color:var(--text-secondary)]">
              Share this with people who aren&apos;t in the Hub (visiting teams, partners,
              parents). Their request lands in the approvals queue flagged as external.
            </p>
          </div>
          {settings && (
            <Button
              size="sm"
              variant={settings.enabled ? "default" : "outline"}
              onClick={toggleEnabled}
              disabled={busy === "toggle"}
              className="shrink-0"
            >
              {busy === "toggle"
                ? "Saving…"
                : settings.enabled
                  ? "On"
                  : "Off"}
            </Button>
          )}
        </div>

        {loadError && <p className="text-sm text-destructive">{loadError}</p>}

        {settings && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="h-9 min-w-0 flex-1 font-mono text-xs"
              />
              <Button size="sm" variant="outline" onClick={copy} className="gap-1.5">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={regenerate}
                disabled={busy === "regen"}
                className="gap-1.5 text-muted-foreground"
              >
                <RefreshCw className="h-4 w-4" />
                {busy === "regen" ? "…" : "Regenerate"}
              </Button>
            </div>

            {!settings.enabled && (
              <p className="text-xs text-amber">
                The link is currently off — visitors see a “link unavailable” notice until
                you turn it on.
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="intro_note" className="text-xs">
                Intro note (optional)
              </Label>
              <textarea
                id="intro_note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Shown at the top of the public form — e.g. who to contact with questions."
                className="flex w-full"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={saveNote}
                disabled={busy === "note" || note === (settings.intro_note ?? "")}
              >
                {busy === "note" ? "Saving…" : "Save note"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
