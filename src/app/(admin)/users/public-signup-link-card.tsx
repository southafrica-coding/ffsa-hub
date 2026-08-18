"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Copy, RefreshCw, Check, Link as LinkIcon, Power } from "lucide-react";

type Props = {
  type: "staff" | "student" | "community";
  label: string;
  description: string;
  initialCode: string;
  initialEnabled: boolean;
  baseUrl: string;
};

export function PublicSignupLinkCard({
  type,
  label,
  description,
  initialCode,
  initialEnabled,
  baseUrl,
}: Props) {
  const [code, setCode] = useState(initialCode);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = `${baseUrl}/join/${code}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't copy — your browser blocked clipboard access.");
    }
  }

  async function handleRegenerate() {
    if (!confirm("Regenerate the public signup link? The current link will stop working immediately.")) {
      return;
    }
    setError(null);
    setRegenerating(true);
    try {
      const res = await fetch("/api/admin/signup-code/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to regenerate");
        return;
      }
      setCode(data.code);
    } catch {
      setError("Network error");
    } finally {
      setRegenerating(false);
    }
  }

  async function handleToggle() {
    setError(null);
    setToggling(true);
    try {
      const res = await fetch("/api/admin/signup-code", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, enabled: !enabled }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to update");
        return;
      }
      setEnabled(data.enabled);
    } catch {
      setError("Network error");
    } finally {
      setToggling(false);
    }
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <LinkIcon className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">{label}</h3>
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 ${
                  enabled
                    ? "bg-green-500/10 text-green-700 dark:text-green-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {enabled ? "Active" : "Disabled"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggle}
            disabled={toggling}
            title={enabled ? "Disable public signup" : "Enable public signup"}
          >
            <Power className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 border bg-muted/40 px-3 py-2 font-mono text-xs truncate">
            {url}
          </div>
          <Button onClick={handleCopy} size="sm" variant="default">
            {copied ? (
              <>
                <Check className="mr-1.5 h-3.5 w-3.5" /> Copied
              </>
            ) : (
              <>
                <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
              </>
            )}
          </Button>
          <Button
            onClick={handleRegenerate}
            size="sm"
            variant="outline"
            disabled={regenerating}
            title="Generate a new link and invalidate the current one"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
