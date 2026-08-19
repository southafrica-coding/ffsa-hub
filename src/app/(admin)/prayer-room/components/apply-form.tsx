"use client";

/**
 * The on-ramp — joining the prayer room, and asking to be evaluated.
 *
 * One form for both, because they are the same act: you say which seats you
 * do, and an evaluator decides what you are signed off for. A person who is
 * already a member uses it to add a seat they were never evaluated for.
 *
 * What it collects, and why each part exists:
 *   · every active seat, as a checkbox — the applicant picks all of them, not
 *     one "how would you like to serve" summary
 *   · per seat, "I have been evaluated for this before" — their OWN claim. It
 *     is never treated as a qualification: the evaluators' queue shows it
 *     beside whatever is actually on record, so the two can disagree in the
 *     open instead of one silently overwriting the other
 *   · their devo experience in their own words
 *
 * Replaces a form that collected generic `labels`, which could never line up
 * with the evaluation system — a label is not a seat (migration 181).
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { StatusPill } from "@/components/ffsa";
import { cn } from "@/lib/utils/cn";

type SeatType = { id: string; label: string; category: string; is_lead: boolean; sort_order: number };

type Application = {
  id: string;
  status: string;
  background: string | null;
  seats?: { seat_type_id: string; previously_evaluated: boolean }[];
};

const STATUS_COPY: Record<string, { pill: "good" | "warn" | "quiet" | "bad"; line: string }> = {
  applied: { pill: "warn", line: "With the evaluators. They will pick it up and arrange to watch you." },
  assigned: { pill: "warn", line: "An evaluator has it and will be in touch." },
  evaluated: { pill: "warn", line: "You have been watched — waiting on the decision." },
  approved: { pill: "good", line: "You are in. Seats you were signed off for are on your profile." },
  denied: { pill: "quiet", line: "Not this time. Talk to the prayer room team about what to work on." },
  withdrawn: { pill: "quiet", line: "Withdrawn." },
};

export default function ApplyForm({ isMember = false }: { isMember?: boolean }) {
  const [seatTypes, setSeatTypes] = useState<SeatType[]>([]);
  const [app, setApp] = useState<Application | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  // seat id -> { picked, evaluatedBefore }
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [before, setBefore] = useState<Record<string, boolean>>({});
  const [background, setBackground] = useState("");

  const load = useCallback(async () => {
    const [metaRes, mineRes] = await Promise.all([
      fetch("/api/prayer-room/wall-meta"),
      fetch("/api/prayer-room/applications/my-status"),
    ]);
    const meta = metaRes.ok ? await metaRes.json() : { seatTypes: [] };
    setSeatTypes(meta.seatTypes ?? []);
    const mine = mineRes.ok ? await mineRes.json() : null;
    setApp(mine && mine.id ? mine : null);
    setReady(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const chosen = seatTypes.filter((s) => picked[s.id]);

  async function submit() {
    if (chosen.length === 0) {
      toast.error("Pick at least one seat");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/prayer-room/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          background: background.trim() || null,
          seats: chosen.map((s) => ({
            seat_type_id: s.id,
            previously_evaluated: !!before[s.id],
          })),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error || "Could not send it");
        return;
      }
      toast.success("Sent — the evaluators will pick it up");
      setPicked({});
      setBefore({});
      setBackground("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <p className="mono-label py-10 text-center">Loading…</p>;

  // An open application blocks a second one; a decided one does not, which is
  // how an existing member comes back to add a seat.
  const open = app && ["applied", "assigned", "evaluated"].includes(app.status);
  const seatLabel = (id: string) => seatTypes.find((s) => s.id === id)?.label ?? id;

  if (open) {
    const copy = STATUS_COPY[app!.status] ?? STATUS_COPY.applied;
    return (
      <div className="border border-ink">
        <div className="section-bar">
          <span className="section-bar-title">Where your ask is</span>
          <span className="section-bar-meta">One at a time</span>
        </div>
        <div className="px-5 py-5 md:px-7">
          <StatusPill tone={copy.pill}>{app!.status}</StatusPill>
          <p className="mt-3 max-w-[560px] text-[14px] leading-[1.55] text-ink">{copy.line}</p>
          {(app!.seats?.length ?? 0) > 0 && (
            <div className="mt-4">
              <div className="mono-label mb-2">Seats you asked about</div>
              <div className="flex flex-wrap gap-1.5">
                {app!.seats!.map((s) => (
                  <span
                    key={s.seat_type_id}
                    className="border border-rule bg-surface-3 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[color:var(--text-secondary)]"
                  >
                    {seatLabel(s.seat_type_id)}
                    {s.previously_evaluated && <span className="ml-1.5 text-amber">· evaluated before</span>}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="border border-ink">
      <div className="section-bar">
        <span className="section-bar-title">{isMember ? "Ask to be evaluated" : "Join the prayer room"}</span>
        <span className="section-bar-meta">{chosen.length} picked</span>
      </div>

      <div className="border-b border-surface-4 px-5 py-5 md:px-7">
        <p className="max-w-[620px] text-[14px] leading-[1.55] text-[color:var(--text-secondary)]">
          {isMember
            ? "Pick any seat you play or lead that you have not been signed off for yet. An evaluator will arrange to watch you."
            : "Pick everything you do in a devo set — all of it, not just your main thing. An evaluator will arrange to watch you, and you get signed off seat by seat."}
        </p>
      </div>

      <div>
        {seatTypes.map((s) => {
          const on = !!picked[s.id];
          return (
            <div
              key={s.id}
              className={cn(
                "flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-surface-4 px-5 py-3 md:px-7",
                on && "bg-bone"
              )}
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => setPicked((p) => ({ ...p, [s.id]: e.target.checked }))}
                  className="h-4 w-4 shrink-0 accent-[#0A0A0A]"
                />
                <span className="font-display text-[20px] font-black uppercase leading-none text-ink">
                  {s.label}
                </span>
                {s.is_lead && <span className="mono-label">Lead seat</span>}
              </label>

              {/* Only meaningful once they have said they do it. */}
              {on && (
                <label className="flex cursor-pointer items-center gap-2 border border-rule-strong bg-white px-2.5 py-1.5">
                  <input
                    type="checkbox"
                    checked={!!before[s.id]}
                    onChange={(e) => setBefore((b) => ({ ...b, [s.id]: e.target.checked }))}
                    className="h-3.5 w-3.5 shrink-0 accent-[#0A0A0A]"
                  />
                  <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[color:var(--text-secondary)]">
                    I have been evaluated for this before
                  </span>
                </label>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-b border-surface-4 px-5 py-5 md:px-7">
        <label htmlFor="pr-background" className="mono-label mb-2 block">
          Your devo experience
        </label>
        <textarea
          id="pr-background"
          rows={5}
          value={background}
          onChange={(e) => setBackground(e.target.value)}
          placeholder="Where you have played or led, how long, who you have served under, anything an evaluator should know before they watch you."
          className="w-full border border-rule-strong px-3 py-3 text-[14px] leading-[1.55]"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-7">
        <p className="text-[12.5px] text-[color:var(--text-tertiary)]">
          Ticking &quot;evaluated before&quot; does not sign you off — an evaluator still records it.
        </p>
        <button
          type="button"
          disabled={busy || chosen.length === 0}
          onClick={submit}
          className="bg-ink px-5 py-3.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.14em] text-white disabled:opacity-40"
        >
          {busy ? "Sending…" : `Send · ${chosen.length} ${chosen.length === 1 ? "seat" : "seats"}`}
        </button>
      </div>
    </div>
  );
}
