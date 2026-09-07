"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Link2, Copy, RefreshCw, Check } from "lucide-react";

/**
 * The shareable request link for people with no Hub account.
 *
 * Fetched on demand rather than with the page: most visits to this page have
 * nothing to do with outsiders, and minting the token on first ask keeps it
 * out of the HTML of every other render.
 */
export function RequestLinkButton() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmingRotate, setConfirmingRotate] = useState(false);

  const url = token
    ? `${typeof window === "undefined" ? "" : window.location.origin}/vr/${token}`
    : "";

  async function load() {
    setOpen(true);
    if (token) return;
    setBusy(true);
    try {
      const res = await fetch("/api/vehicles/request-link");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not load the request link.");
        return;
      }
      setToken(json.token);
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
      const res = await fetch("/api/vehicles/request-link", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not rotate the link.");
        return;
      }
      setToken(json.token);
      setConfirmingRotate(false);
      toast.success("New link created. The old one no longer works.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="gap-1.5" onClick={load}>
        <Link2 className="h-4 w-4" />
        Request link
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border border-rule bg-bone px-3 py-2">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        Outside link
      </span>
      <input
        readOnly
        value={busy && !token ? "Loading…" : url}
        onFocus={(e) => e.currentTarget.select()}
        className="h-8 w-72 max-w-full border border-rule-strong bg-white px-2 text-xs"
      />
      <Button size="sm" variant="outline" className="gap-1.5" onClick={copy} disabled={!token}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy"}
      </Button>
      {confirmingRotate ? (
        <>
          <span className="text-xs text-destructive">
            Everyone who already has the link loses it. Sure?
          </span>
          <Button size="sm" variant="destructive" onClick={rotate} disabled={busy}>
            Yes, replace it
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmingRotate(false)}>
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
          New link
        </Button>
      )}
    </div>
  );
}
