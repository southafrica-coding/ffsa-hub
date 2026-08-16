"use client";

/**
 * Filling a seat — design rule 3.
 *
 * Replaces the flat "pick anyone with this skill" list. The picker offers
 * signed-off people first, least-loaded first within that, flags people still
 * in training, and surfaces a clash instead of letting the database refuse the
 * fill afterwards.
 *
 * Choosing someone who is not signed off is possible but never accidental: it
 * takes a second, explicit confirmation, and the UI says who will hear about it.
 */

import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { StatusPill } from "@/components/ffsa";
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

export default function SeatPicker({
  open,
  onClose,
  seatTypeId,
  seatLabel,
  setId,
  busyId,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  seatTypeId: string | null;
  seatLabel?: string;
  setId?: string | null;
  busyId?: string | null;
  onPick: (userId: string) => void;
}) {
  const [rows, setRows] = useState<Candidate[]>([]);
  const [search, setSearch] = useState("");
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
      setConfirming(null);
      load();
    }
  }, [open, load]);

  const filtered = rows.filter((r) =>
    search ? fullName(r.user).toLowerCase().includes(search.toLowerCase()) : true
  );

  function choose(c: Candidate) {
    if (c.state === "signed_off" && !c.clash) {
      onPick(c.user_id);
      return;
    }
    setConfirming(c);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{seatLabel ? `Fill ${seatLabel}` : "Fill this seat"}</DialogTitle>
        </DialogHeader>

        {confirming ? (
          <div className="space-y-4">
            <div className="border border-ink bg-bone p-4">
              <p className="text-sm font-semibold">{fullName(confirming.user)}</p>

              {confirming.state !== "signed_off" && (
                <p className="mt-2 text-[13px] text-[color:var(--text-secondary)]">
                  {confirming.state === "in_training"
                    ? "They are still in training for this seat. Evaluators will be told you filled it anyway."
                    : "Nobody has evaluated them for this seat yet. Evaluators will be told you filled it anyway."}
                </p>
              )}

              {confirming.clash && (
                <p className="mt-2 flex items-start gap-2 text-[13px] text-[color:var(--destructive)]">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    They are already on{" "}
                    <strong>{confirming.clash.title || "another set"}</strong> at{" "}
                    {confirming.clash.start_time.slice(0, 5)} that day. Two seats at the same
                    time will be refused.
                  </span>
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirming(null)}>
                Back
              </Button>
              <Button
                disabled={!!confirming.clash || busyId === confirming.user_id}
                onClick={() => {
                  onPick(confirming.user_id);
                  setConfirming(null);
                }}
              >
                {confirming.clash ? "Can't fill" : "Fill anyway"}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Input
              placeholder="Search people…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <div className="max-h-80 divide-y divide-[color:var(--surface-4)] overflow-y-auto border border-rule">
              {loading ? (
                <p className="mono-label py-6 text-center">Loading…</p>
              ) : filtered.length === 0 ? (
                <p className="mono-label py-6 text-center">No active members</p>
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.user_id}
                    type="button"
                    disabled={busyId === c.user_id}
                    onClick={() => choose(c)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-bone",
                      c.state !== "signed_off" && "opacity-80"
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium">{fullName(c.user)}</div>
                      <div className="mono-label mt-0.5">
                        {c.load} {c.load === 1 ? "set" : "sets"} · last 30 days
                        {c.clash && " · clashes"}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {c.clash && <AlertTriangle className="h-3.5 w-3.5 text-[color:var(--destructive)]" />}
                      <StatusPill tone={STATE_TONE[c.state]}>{STATE_LABEL[c.state]}</StatusPill>
                    </div>
                  </button>
                ))
              )}
            </div>

            <p className="mono-label">
              Signed off first, then whoever has carried the least
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
