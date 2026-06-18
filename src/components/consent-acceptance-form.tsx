"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

// Blocking privacy-consent screen for users who have no acceptance on
// record. Mirrors the onboarding consent step but lives in the gate so
// returning users who never consented are caught too. Records against the
// current published agreement version via POST /api/consent.
export function ConsentAcceptanceForm({
  version,
  title,
}: {
  version: string;
  title: string;
}) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!accepted) {
      setError("Please tick the box to accept the agreement.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agreement_version: version, source: "onboarding" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to record consent");
        return;
      }
      // Refresh — the gate re-checks and lets them through.
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">
          {title || "Privacy & Data Processing Agreement"}
        </CardTitle>
        <CardDescription>
          Please review and accept to continue using the Hub.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            We need your consent to collect and use your personal information
            for program administration, communications, and legal compliance.
          </p>

          <a
            href="/legal/consent"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm font-medium text-primary underline"
          >
            Open the full agreement →
          </a>

          <label className="flex items-start gap-3 cursor-pointer rounded-lg border p-3">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span className="text-sm">
              I have read and agree to the FFSA Privacy &amp; Data Processing
              Agreement, and I consent to FFSA collecting, storing, and using my
              personal information for the purposes described in it.
            </span>
          </label>

          {version && (
            <p className="text-xs text-muted-foreground">
              Agreement version: <span className="font-mono">{version}</span>
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Saving..." : "Accept & Continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
