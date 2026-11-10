"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Check, RefreshCw, Link2 } from "lucide-react";
import { ShareLinkQr } from "@/components/share/share-link-qr";

/**
 * The shareable door link for a welcome team with no Hub accounts.
 *
 * Fetched on demand rather than with the page: most visits to the check-in
 * tab have nothing to do with outsiders, and minting the token on first ask
 * keeps it out of the HTML of every other render.
 */
export function ScanLinkCard({ eventId }: { eventId: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmingRotate, setConfirmingRotate] = useState(false);

  const url = token
    ? `${typeof window === "undefined" ? "" : window.location.origin}/scan/${token}`
    : "";

  type LinkPayload = {
    token: string;
    isActive: boolean;
    expiresAt: string | null;
  };

  function apply(json: LinkPayload) {
    setToken(json.token);
    setIsActive(json.isActive);
    setExpiresAt(json.expiresAt);
  }

  async function load() {
    setOpen(true);
    if (token) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${eventId}/scan-link`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not load the door link.");
        return;
      }
      apply(json as LinkPayload);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the link and copy it by hand.");
    }
  }

  async function rotate() {
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${eventId}/scan-link`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not replace the link.");
        return;
      }
      apply(json as LinkPayload);
      setConfirmingRotate(false);
      toast.success("New link created. The old one no longer works.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${eventId}/scan-link`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error ?? "Could not change the link.");
        return;
      }
      setIsActive(next);
      toast.success(next ? "Door link is live." : "Door link switched off.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Welcome team link</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="max-w-xl text-sm text-muted-foreground">
          Share one link with your door team. Anyone who has it can scan
          tickets on their own phone — no Hub login, no profile, nothing to set
          up. Treat it like a key: it also shows the guest list by name and can
          undo check-ins, so send it to your door team only.
        </p>

        {!open ? (
          <Button
            size="sm"
            variant="outline"
            className="mt-4 gap-1.5"
            onClick={load}
          >
            <Link2 className="h-4 w-4" />
            Get the link
          </Button>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <input
                  readOnly
                  value={busy && !token ? "Loading…" : url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-9 min-w-0 w-full flex-1 border border-rule-strong bg-white px-2 font-mono text-xs sm:w-auto"
                  aria-label="Welcome team door link"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={copy}
                  disabled={!token || !isActive}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              {url ? (
                <ShareLinkQr
                  url={url}
                  filename={token ?? "door"}
                  label="QR code for the welcome team door link"
                  showCopy={false}
                />
              ) : null}
            </div>

            {!isActive && (
              <p className="text-xs text-destructive">
                This link is switched off — it won&apos;t open for anyone.
              </p>
            )}
            {isActive && expiresAt && (
              <p className="text-xs text-muted-foreground">
                Stops working automatically on{" "}
                {new Date(expiresAt).toLocaleDateString()}.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => toggle(!isActive)}
                disabled={busy || !token}
              >
                {isActive ? "Switch off" : "Switch back on"}
              </Button>

              {confirmingRotate ? (
                <>
                  <span className="text-xs text-destructive">
                    Everyone who already has the link loses it. Sure?
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={rotate}
                    disabled={busy}
                  >
                    Yes, replace it
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmingRotate(false)}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-muted-foreground"
                  onClick={() => setConfirmingRotate(true)}
                  disabled={!token}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Replace link
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
