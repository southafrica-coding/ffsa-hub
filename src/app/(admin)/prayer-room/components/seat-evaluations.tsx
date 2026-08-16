"use client";

/**
 * The evaluators' queue — design frame 12a.
 *
 * People who have asked to be looked at for a seat, oldest first, and the
 * two-note form for recording the result. Separate from the applications list
 * below it: that one is about joining the room at all, this one is about
 * whether someone may hold a particular seat.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { SectionBar, Initials, StatusPill } from "@/components/ffsa";
import EvaluationForm from "./evaluation-form";
import { fullName, roleLabel, type Person } from "./helpers";

type EvalRequest = {
  id: string;
  seat_type_id: string;
  user_id: string;
  state: "waiting" | "booked" | "done" | "cancelled";
  note: string | null;
  scheduled_at: string | null;
  created_at: string;
  user: Person;
};

function waitingDays(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export default function SeatEvaluations() {
  const [rows, setRows] = useState<EvalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState<EvalRequest | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/prayer-room/requests?kind=eval&state=waiting,booked");
      setRows(res.ok ? await res.json() : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setState(id: string, state: "booked" | "done" | "cancelled") {
    setBusy(id);
    try {
      const res = await fetch("/api/prayer-room/requests?kind=eval", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, state }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || "Could not update");
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (loading) return null;
  if (rows.length === 0) return null;

  return (
    <>
      <div className="mb-6 border border-ink">
        <SectionBar title="Waiting to be evaluated" meta={`${rows.length} in the queue`} />
        <div className="divide-y divide-[color:var(--surface-4)]">
          {rows.map((r) => (
            <div key={r.id} className="flex items-start gap-3 px-4 py-3">
              <Initials name={fullName(r.user)} size={30} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{fullName(r.user)}</div>
                <div className="mono-label mt-0.5">
                  {roleLabel(r.seat_type_id)} · waiting {waitingDays(r.created_at)}{" "}
                  {waitingDays(r.created_at) === 1 ? "day" : "days"}
                </div>
                {r.note && (
                  <p className="mt-1 text-[12px] text-[color:var(--text-secondary)]">{r.note}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusPill tone={r.state === "booked" ? "good" : "warn"}>
                  {r.state === "booked" ? "Booked" : "Waiting"}
                </StatusPill>
                {r.state === "waiting" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === r.id}
                    onClick={() => setState(r.id, "booked")}
                  >
                    Book
                  </Button>
                )}
                <Button size="sm" disabled={busy === r.id} onClick={() => setEvaluating(r)}>
                  Evaluate
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={!!evaluating} onOpenChange={(o) => !o && setEvaluating(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Record an evaluation</DialogTitle>
          </DialogHeader>
          {evaluating && (
            <EvaluationForm
              userId={evaluating.user_id}
              personName={fullName(evaluating.user)}
              seatTypeId={evaluating.seat_type_id}
              seatLabel={roleLabel(evaluating.seat_type_id)}
              onCancel={() => setEvaluating(null)}
              onSaved={async () => {
                // The ask is answered once the evaluation exists.
                await setState(evaluating.id, "done");
                setEvaluating(null);
                await load();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
