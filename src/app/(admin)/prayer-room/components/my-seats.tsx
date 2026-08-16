"use client";

/**
 * A member's own seats — design frame 11a.
 *
 * Where you stand on each seat, how to ask to be looked at, and the feedback
 * evaluators have written FOR you.
 *
 * The feedback comes from prayer_room_my_evaluations, a view that does not
 * contain the evaluators' private note. There is deliberately no hint here
 * that a second note exists: the person sees what was written for them, and
 * nothing about what was written about them.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { SectionBar, StatusPill } from "@/components/ffsa";
import { roleLabel } from "./helpers";

type QualState = "not_evaluated" | "in_training" | "signed_off";
type SeatType = { id: string; label: string; is_lead: boolean };
type Qual = { seat_type_id: string; state: QualState };
type Feedback = {
  id: string;
  seat_type_id: string | null;
  seat_label: string | null;
  outcome: string | null;
  feedback: string;
  created_at: string;
};
type EvalRequest = { id: string; seat_type_id: string; state: string };

const LABEL: Record<QualState, string> = {
  signed_off: "Signed off",
  in_training: "In training",
  not_evaluated: "Not evaluated",
};
const TONE: Record<QualState, "good" | "warn" | "quiet"> = {
  signed_off: "good",
  in_training: "warn",
  not_evaluated: "quiet",
};

export default function MySeats() {
  const [seats, setSeats] = useState<SeatType[]>([]);
  const [quals, setQuals] = useState<Qual[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [asks, setAsks] = useState<EvalRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const [metaRes, qualRes, fbRes, askRes] = await Promise.all([
      fetch("/api/prayer-room/wall-meta"),
      fetch("/api/prayer-room/evaluations"),
      fetch("/api/prayer-room/evaluations?mine=feedback"),
      fetch("/api/prayer-room/requests?kind=eval&state=waiting,booked"),
    ]);
    const meta = metaRes.ok ? await metaRes.json() : { seatTypes: [] };
    setSeats(meta.seatTypes ?? []);
    setQuals(qualRes.ok ? await qualRes.json() : []);
    setFeedback(fbRes.ok ? await fbRes.json() : []);
    setAsks(askRes.ok ? await askRes.json() : []);
    setReady(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function ask(seatTypeId: string) {
    setBusy(seatTypeId);
    try {
      const res = await fetch("/api/prayer-room/requests?kind=eval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seat_type_id: seatTypeId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error || "Could not send the request");
        return;
      }
      toast.success("Asked — an evaluator will pick it up");
      await load();
    } finally {
      setBusy(null);
    }
  }

  // Nothing to show until the seat vocabulary exists (migration 167).
  if (!ready || seats.length === 0) return null;

  const stateOf = (id: string): QualState =>
    (quals.find((q) => q.seat_type_id === id)?.state as QualState) ?? "not_evaluated";
  const askedFor = new Set(asks.map((a) => a.seat_type_id));

  return (
    <div className="space-y-6">
      <div className="border border-ink">
        <SectionBar title="My seats" />
        <div className="divide-y divide-[color:var(--surface-4)]">
          {seats.map((s) => {
            const state = stateOf(s.id);
            const pending = askedFor.has(s.id);
            return (
              <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">{s.label}</div>
                  {s.is_lead && <div className="mono-label mt-0.5">Lead seat</div>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusPill tone={TONE[state]}>{LABEL[state]}</StatusPill>
                  {state !== "signed_off" &&
                    (pending ? (
                      <span className="mono-label">Asked</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === s.id}
                        onClick={() => ask(s.id)}
                      >
                        Ask to be evaluated
                      </Button>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {feedback.length > 0 && (
        <div className="border border-ink">
          <SectionBar title="Feedback for me" meta={`${feedback.length}`} />
          <div className="divide-y divide-[color:var(--surface-4)]">
            {feedback.map((f) => (
              <div key={f.id} className="px-4 py-3">
                <div className="mono-label">
                  {f.seat_label || roleLabel(f.seat_type_id || "")} ·{" "}
                  {new Date(f.created_at).toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </div>
                <p className="mt-1.5 border-l-4 border-yellow bg-[color:var(--yellow-dim)] p-3 text-[13px] leading-relaxed">
                  {f.feedback}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
