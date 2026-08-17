"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { fullName, APPLICATION_STATUS_LABELS, type Person } from "./helpers";

interface Evaluation {
  id: string;
  notes: string | null;
  met_at: string | null;
  evaluator_id: string;
}
interface Application {
  id: string;
  status: string;
  background: string | null;
  applicant: Person;
  skills: { label: { id: string; name: string } | null }[];
  evaluations: Evaluation[];
}

export default function Evaluations({ userId }: { userId: string }) {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/prayer-room/applications?scope=assigned");
      setApps(res.ok ? await res.json() : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="py-12 text-center text-muted-foreground">Loading…</p>;

  const open = apps.filter((a) => a.status === "assigned" || a.status === "evaluated");
  const done = apps.filter((a) => a.status === "approved" || a.status === "denied");

  return (
    // The seat queue and band curation moved to `evaluators.tsx` when frame 12a
    // made the portal its own tab. What is left here is the one-off "should
    // this person join the room at all" pipeline, which is a different question.
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Applicants to evaluate</h2>
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">No applicants assigned to you right now.</p>
        ) : (
          <div className="space-y-3">
            {open.map((a) => (
              <EvaluationCard key={a.id} app={a} userId={userId} onChanged={load} />
            ))}
          </div>
        )}
      </section>

      {done.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Decided</h2>
          <div className="space-y-2">
            {done.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm">
                <span>{fullName(a.applicant)}</span>
                <Badge variant={a.status === "approved" ? "default" : "secondary"}>
                  {APPLICATION_STATUS_LABELS[a.status]}
                </Badge>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function EvaluationCard({ app, userId, onChanged }: { app: Application; userId: string; onChanged: () => void }) {
  const myEval = app.evaluations.find((e) => e.evaluator_id === userId) ?? app.evaluations[0];
  const [notes, setNotes] = useState(myEval?.notes ?? "");
  const [decisionNote, setDecisionNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function call(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const res = await fetch(`/api/prayer-room/applications/${app.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      toast.success(
        key === "evaluate" ? "Evaluation saved" : body.approve ? "Approved — welcome them in!" : "Marked not approved"
      );
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium">{fullName(app.applicant)}</span>
          <Badge variant="outline" className="ml-2 text-[10px]">
            {APPLICATION_STATUS_LABELS[app.status]}
          </Badge>
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1">
        {app.skills.map((s, i) => s.label && <Badge key={i} variant="secondary" className="text-[10px]">{s.label.name}</Badge>)}
      </div>

      {app.background && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{app.background}</p>}

      <div className="mt-3 space-y-1">
        <Label className="text-xs">Evaluation notes</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Notes from your meeting…" />
        <Button size="sm" variant="outline" disabled={busy === "evaluate"} onClick={() => call({ action: "evaluate", notes }, "evaluate")}>
          {app.status === "evaluated" ? "Update notes" : "Save evaluation"}
        </Button>
      </div>

      <div className="mt-3 space-y-2 border-t border-border pt-3">
        <Label className="text-xs">Decision note (optional, shared with applicant)</Label>
        <Textarea value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} rows={2} />
        <div className="flex gap-2">
          <Button size="sm" disabled={busy === "decide"} onClick={() => call({ action: "decide", approve: true, decision_note: decisionNote || null }, "decide")}>
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive"
            disabled={busy === "decide"}
            onClick={() => call({ action: "decide", approve: false, decision_note: decisionNote || null }, "decide")}
          >
            Deny
          </Button>
        </div>
      </div>
    </div>
  );
}
