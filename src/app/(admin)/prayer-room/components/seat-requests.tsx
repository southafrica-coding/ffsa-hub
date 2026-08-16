"use client";

/**
 * The lead's inbox for a set: who has asked for a seat on it.
 *
 * Accepting records the decision only. Filling still happens through the
 * roster above, so the cross-set overlap guard (migration 108) keeps its say —
 * routing the fill from here would slip past it.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { SectionBar, Initials } from "@/components/ffsa";
import { fullName, roleLabel, type Person } from "./helpers";

type SeatRequest = {
  id: string;
  seat_type_id: string;
  user_id: string;
  state: string;
  message: string | null;
  created_at: string;
  user: Person;
};

export default function SeatRequests({
  setId,
  canDecide,
  onDecided,
}: {
  setId: string;
  canDecide: boolean;
  onDecided?: () => void;
}) {
  const [rows, setRows] = useState<SeatRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/prayer-room/requests?kind=seat&setId=${setId}&state=pending`);
    setRows(res.ok ? await res.json() : []);
  }, [setId]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(id: string, state: "accepted" | "declined") {
    setBusy(id);
    try {
      const res = await fetch("/api/prayer-room/requests?kind=seat", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, state }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || "Could not update the request");
        return;
      }
      toast.success(
        state === "accepted" ? "Accepted — now fill the seat above" : "Declined"
      );
      await load();
      onDecided?.();
    } finally {
      setBusy(null);
    }
  }

  // No asks, no panel. An empty inbox is not worth the space.
  if (rows.length === 0) return null;

  return (
    <div className="border border-ink">
      <SectionBar title="Asked for a seat" meta={`${rows.length} waiting`} />
      <div className="divide-y divide-[color:var(--surface-4)]">
        {rows.map((r) => (
          <div key={r.id} className="flex items-start gap-3 px-4 py-3">
            <Initials name={fullName(r.user)} size={28} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{fullName(r.user)}</div>
              <div className="mono-label mt-0.5">{roleLabel(r.seat_type_id)}</div>
              {r.message && (
                <p className="mt-1 text-[12px] text-[color:var(--text-secondary)]">{r.message}</p>
              )}
            </div>
            {canDecide && (
              <div className="flex shrink-0 gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === r.id}
                  onClick={() => decide(r.id, "declined")}
                >
                  Decline
                </Button>
                <Button size="sm" disabled={busy === r.id} onClick={() => decide(r.id, "accepted")}>
                  Accept
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
