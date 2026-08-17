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

// One outstanding policy the user must accept.
export type OutstandingAgreement = {
  kind: string;
  version: string;
  title: string;
};

// Blocking panel that collects EVERY policy a user still owes in one pass.
// Each row links to the full text (/legal/consent?kind=…) and has its own
// required checkbox; "Accept & continue" is enabled only when all are ticked,
// then records each acceptance and refreshes so the gate re-evaluates.
export function RequiredAgreementsForm({
  agreements,
}: {
  agreements: OutstandingAgreement[];
}) {
  const router = useRouter();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allChecked = agreements.every((a) => checked[a.kind]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!allChecked) {
      setError("Please tick every box to confirm you agree to each policy.");
      return;
    }
    setLoading(true);
    try {
      // Record each acceptance. Any failure stops and surfaces the error;
      // already-recorded ones are harmless (the gate just re-asks for the rest).
      for (const a of agreements) {
        const res = await fetch("/api/consent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: a.kind,
            agreement_version: a.version,
            source: "onboarding",
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(
            data.error || `Could not record your acceptance of “${a.title}”.`
          );
          setLoading(false);
          return;
        }
      }
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  const heading =
    agreements.length === 1 ? "One more thing" : "A few agreements to confirm";

  return (
    <Card className="w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">{heading}</CardTitle>
        <CardDescription>
          Before you continue, please read and agree to the following
          {agreements.length === 1 ? " policy" : " policies"}. Open each to read
          the full text, then tick the box to confirm.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {agreements.map((a) => (
            <div key={a.kind} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{a.title}</span>
                <a
                  href={`/legal/consent?kind=${a.kind}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-xs font-medium text-primary underline"
                >
                  Open to read →
                </a>
              </div>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked[a.kind] ?? false}
                  onChange={(e) =>
                    setChecked((prev) => ({ ...prev, [a.kind]: e.target.checked }))
                  }
                  className="mt-0.5 h-4 w-4"
                />
                <span className="text-sm">
                  I have read and agree to the {a.title}.
                </span>
              </label>
              <p className="text-[11px] text-muted-foreground">
                Version <span className="font-mono">{a.version}</span>
              </p>
            </div>
          ))}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading || !allChecked}>
            {loading ? "Saving…" : "Accept & Continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
