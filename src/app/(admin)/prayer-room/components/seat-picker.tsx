"use client";

/**
 * Filling a seat — design frame 10b, middle panel (and design rule 3).
 *
 * A panel, not a dialog: it opens on top of the set drawer with a "← FILL A
 * SEAT" header, so the lead can back out to the lineup they came from.
 *
 * Only people signed off for the seat lead the list, least-loaded first,
 * people still in training are marked, and a clash is surfaced here rather
 * than left for the database to refuse afterwards. Choosing someone who is not
 * signed off is possible but never accidental: it takes a second, explicit
 * confirmation, and the panel says who will hear about it.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Initials, StatusPill } from "@/components/ffsa";
import { Drawer } from "@/components/ffsa/client";
import { cn } from "@/lib/utils/cn";
import { fullName } from "./helpers";

type QualState = "not_evaluated" | "in_training" | "signed_off";

type Candidate = {
  user_id: string;
  user: { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null };
  state: QualState;
  load: number;
  clash: { set_id: string; title: string | null; start_time: string; set_date: string } | null;
};

const STATE_LABEL: Record<QualState, string> = {
  signed_off: "Signed off",
  in_training: "In training",
  not_evaluated: "Not evaluated",
};

const STATE_TONE: Record<QualState, "good" | "warn" | "quiet"> = {
  signed_off: "good",
  in_training: "warn",
  not_evaluated: "quiet",
};

type Filter = "all" | "free" | "training";

export default function SeatFill({
  open,
  onClose,
  seatTypeId,
  seatLabel,
  setContext,
  setId,
  busyId,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  seatTypeId: string | null;
  seatLabel?: string;
  /** "NEPAL FOCUS · MON 08:00 – 09:30" — the line above the seat name in 10b. */
  setContext?: string;
  setId?: string | null;
  busyId?: string | null;
  onPick: (userId: string) => void;
}) {
  const [rows, setRows] = useState<Candidate[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(false);
  // The person an override is being confirmed for. Nothing is written until
  // the lead confirms twice.
  const [confirming, setConfirming] = useState<Candidate | null>(null);

  const load = useCallback(async () => {
    if (!seatTypeId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ seat: seatTypeId });
      if (setId) params.set("setId", setId);
      const res = await fetch(`/api/prayer-room/candidates?${params}`);
      const data = res.ok ? await res.json() : { candidates: [] };
      setRows(data.candidates ?? []);
    } finally {
      setLoading(false);
    }
  }, [seatTypeId, setId]);

  useEffect(() => {
    if (open) {
      setSearch("");
      setFilter("all");
      setConfirming(null);
      load();
    }
  }, [open, load]);

  const filtered = rows
    .filter((r) => (search ? fullName(r.user).toLowerCase().includes(search.toLowerCase()) : true))
    .filter((r) => (filter === "free" ? !r.clash : filter === "training" ? r.state === "in_training" : true));

  const available = rows.filter((r) => r.state === "signed_off" && !r.clash).length;

  function choose(c: Candidate) {
    if (c.state === "signed_off" && !c.clash) {
      onPick(c.user_id);
      return;
    }
    setConfirming(c);
  }

  return (
    <Drawer open={open} onClose={onClose} label="← Fill a seat">
      {confirming ? (
        <>
          <div className="flex-1 px-6 py-6">
            <div className="border border-ink bg-bone p-4">
              <p className="text-[15px] font-bold text-ink">{fullName(confirming.user)}</p>

              {confirming.state !== "signed_off" && (
                <p className="mt-2 text-[13px] leading-[1.5] text-[color:var(--text-secondary)]">
                  {confirming.state === "in_training"
                    ? "They are still in training for this seat. Evaluators will be told you filled it anyway."
                    : "Nobody has evaluated them for this seat yet. Evaluators will be told you filled it anyway."}
                </p>
              )}

              {confirming.clash && (
                <p className="mt-2 flex items-start gap-2 text-[13px] leading-[1.5] text-[color:var(--destructive)]">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    They are already on <strong>{confirming.clash.title || "another set"}</strong> at{" "}
                    {confirming.clash.start_time.slice(0, 5)} that day. Two seats at the same time will be
                    refused.
                  </span>
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2 border-t border-surface-4 px-6 py-4">
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className="border border-ink px-4 py-3.5 font-mono text-[10.5px] font-bold tracking-[0.12em] text-ink"
            >
              BACK
            </button>
            <button
              type="button"
              disabled={!!confirming.clash || busyId === confirming.user_id}
              onClick={() => {
                onPick(confirming.user_id);
                setConfirming(null);
              }}
              className="flex-1 bg-ink px-4 py-3.5 font-mono text-[10.5px] font-bold tracking-[0.14em] text-white disabled:opacity-40"
            >
              {confirming.clash ? "CAN'T FILL" : "ASK THEM ANYWAY"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="border-b border-surface-4 px-6 pb-4 pt-5">
            {setContext && (
              <div className="mb-2.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-[color:var(--text-tertiary)]">
                {setContext}
              </div>
            )}
            <h2 className="font-display text-[34px] font-black uppercase leading-[0.95] text-ink sm:text-[38px]">
              {seatLabel ?? "This seat"}
            </h2>
            <p className="mt-2 text-[13.5px] leading-[1.5] text-[color:var(--text-secondary)]">
              Only people signed off for {seatLabel ? seatLabel.toLowerCase() : "this seat"} lead the list.{" "}
              {available === 0
                ? "Nobody is free and signed off right now."
                : `${available} available, sorted by who's carrying the least.`}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5 px-6 pb-2.5 pt-3.5">
            {(
              [
                ["all", seatLabel ?? "All"],
                ["free", "Free then"],
                ["training", "In training"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={cn(
                  "px-2.5 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em]",
                  filter === key
                    ? "bg-ink text-white"
                    : "border border-rule-strong text-[color:var(--text-secondary)]"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="px-6 pb-2">
            <Input placeholder="Search people…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <div className="flex-1">
            {loading ? (
              <p className="mono-label py-10 text-center">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="mono-label py-10 text-center">Nobody matches</p>
            ) : (
              filtered.map((c) => (
                <div
                  key={c.user_id}
                  className="flex items-center gap-3 border-b border-surface-3 px-6 py-3.5"
                >
                  <Initials name={fullName(c.user)} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-bold text-ink">{fullName(c.user)}</div>
                    <div className="mt-0.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-[color:var(--text-quiet)]">
                      {STATE_LABEL[c.state]} · {c.load} {c.load === 1 ? "set" : "sets"} · 30 days
                    </div>
                    <div
                      className={cn(
                        "mt-1 text-[12px]",
                        c.clash ? "text-[color:var(--destructive)]" : "text-[color:var(--text-tertiary)]"
                      )}
                    >
                      {c.clash
                        ? `On ${c.clash.title || "another set"} at ${c.clash.start_time.slice(0, 5)}`
                        : "Free then"}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {c.state !== "signed_off" && (
                      <StatusPill tone={STATE_TONE[c.state]}>{STATE_LABEL[c.state]}</StatusPill>
                    )}
                    <button
                      type="button"
                      disabled={busyId === c.user_id}
                      onClick={() => choose(c)}
                      className={cn(
                        "border px-3 py-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] disabled:opacity-40",
                        c.state === "signed_off" && !c.clash
                          ? "border-ink bg-ink text-white"
                          : "border-rule-strong bg-white text-[color:var(--text-secondary)]"
                      )}
                    >
                      {c.state === "signed_off" && !c.clash ? "Ask" : "Ask anyway"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-surface-4 px-6 py-4">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border border-ink bg-ink text-[11px] font-bold text-yellow">
                ✓
              </span>
              <span className="text-[12.5px] leading-[1.5] text-[color:var(--text-secondary)]">
                They accept or decline rather than being added outright — the seat stays invited until
                they answer.
              </span>
            </div>
            <p className="mt-3 text-[12px] text-[color:var(--text-tertiary)]">
              Someone missing? They need signing off for {seatLabel ? seatLabel.toLowerCase() : "this seat"} first.
            </p>
          </div>
        </>
      )}
    </Drawer>
  );
}
