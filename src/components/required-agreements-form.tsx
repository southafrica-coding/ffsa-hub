"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { recordAgreements } from "@/lib/onboarding/save-agreements";
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
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allChecked = agreements.every((a) => checked[a.kind]);

  // Once signed, the gate clears on the next server render. router.refresh()
  // normally does that; if it hasn't swapped this panel out after a few
  // seconds, a full reload re-runs the gate for certain.
  useEffect(() => {
    if (!done) return;
    router.refresh();
    const t = setTimeout(() => window.location.reload(), 4000);
    return () => clearTimeout(t);
  }, [done, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!allChecked) {
      setError("Please tick every box to confirm you agree to each policy.");
      return;
    }
    setLoading(true);
    // Never hangs: resolves to ok or a plain error. Already-recorded
    // signatures are kept, and re-sending one is a no-op on the server.
    const outcome = await recordAgreements(agreements);
    setLoading(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <Card className="w-full max-w-lg mx-4 shadow-2xl">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Thank you — you&rsquo;ve signed</CardTitle>
          <CardDescription>
            {agreements.length === 1
              ? `Your signature on the ${agreements[0].title} is saved.`
              : "Your signatures are saved."}{" "}
            Taking you into the Hub…
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={() => window.location.reload()}>
            Continue
          </Button>
        </CardContent>
      </Card>
    );
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
            {loading ? "Saving…" : error ? "Try again" : "Accept & Continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
