"use client";

/**
 * The lead's inbox across every set they lead — design frame 10b, right panel.
 *
 * `seat-requests.tsx` is the same queue narrowed to one set, shown inside the
 * set drawer. This one is what the People tab's yellow band opens.
 *
 * "Give them the seat" does two things in order: record the decision, then
 * invite them into the matching open seat through the ordinary roster path.
 * Filling any other way would slip past the cross-set overlap guard from
 * migration 108, so the invite goes through /slots exactly as the picker does.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Drawer, Initials } from "@/components/ffsa";
import { fullName, formatDateLabel, formatTime, type Person } from "./helpers";

type SeatRequest = {
  id: string;
  set_id: string;
  seat_type_id: string;
  user_id: string;
  state: string;
  message: string | null;
  created_at: string;
  user: Person;
  set: { id: string; set_date: string; start_time: string; end_time: string; title: string | null } | null;
};

type Slot = { id: string; role: string; seat_type_id?: string | null; status: string };

function askedAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

export default function JoinRequests({
  open,
  onClose,
  seatLabel,
  onDecided,
}: {
  open: boolean;
  onClose: () => void;
  seatLabel: (seatTypeId: string) => string;
  onDecided?: () => void;
}) {
  const [rows, setRows] = useState<SeatRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/prayer-room/requests?kind=seat&state=pending");
      setRows(res.ok ? await res.json() : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function decide(r: SeatRequest, state: "accepted" | "declined") {
    setBusy(r.id);
    try {
      const res = await fetch("/api/prayer-room/requests?kind=seat", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.id, state }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || "Could not update the request");
        return;
      }

      if (state === "declined") {
        toast.success("Declined");
      } else {
        // Find the open seat they asked for and invite them into it.
        const setRes = await fetch(`/api/prayer-room/sets?id=${r.set_id}`);
        const set = setRes.ok ? await setRes.json() : null;
        const slot = (set?.slots as Slot[] | undefined)?.find(
          (s) => (s.seat_type_id ?? s.role) === r.seat_type_id && (s.status === "open" || s.status === "declined")
        );
        if (!slot) {
          toast.success("Accepted — that seat is no longer open, so fill it from the set");
        } else {
          const inv = await fetch(`/api/prayer-room/slots/${slot.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "invite", invitee_id: r.user_id }),
          });
          if (!inv.ok) {
            const d = await inv.json().catch(() => ({}));
            toast.error(d.error || "Accepted, but the seat could not be filled");
          } else {
            toast.success("Seat is theirs — they've been told");
          }
        }
      }

      await load();
      onDecided?.();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} label="Requests to join">
      <div className="border-b border-surface-4 px-6 pb-4 pt-5">
        <h2 className="font-display text-[30px] font-black uppercase leading-[0.95] text-ink sm:text-[34px]">
          {loading
            ? "Loading…"
            : rows.length === 0
              ? "Nobody waiting"
              : `${rows.length} ${rows.length === 1 ? "person wants" : "people want"} a seat`}
        </h2>
        <p className="mt-2.5 text-[13.5px] leading-[1.5] text-[color:var(--text-secondary)]">
          All on sets you lead. Approving puts them in the seat and tells them.
        </p>
      </div>

      <div className="flex-1">
        {rows.map((r) => (
          <div key={r.id} className="border-b border-surface-3 px-6 py-4">
            <div className="flex items-center gap-3">
              <Initials name={fullName(r.user)} size={32} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-bold text-ink">{fullName(r.user)}</div>
                <div className="mt-0.5 truncate font-mono text-[8.5px] uppercase tracking-[0.1em] text-[color:var(--text-quiet)]">
                  {r.set
                    ? `${r.set.title || "Devo set"} · ${formatDateLabel(r.set.set_date)} ${formatTime(r.set.start_time)}`
                    : "Set removed"}
                </div>
              </div>
              <span className="shrink-0 border border-rule-strong px-1.5 py-1 font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">
                {seatLabel(r.seat_type_id)}
              </span>
            </div>

            {r.message && (
              <p className="mt-2 pl-[44px] text-[12.5px] leading-[1.5] text-[color:var(--text-secondary)]">
                {r.message}
              </p>
            )}

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={busy === r.id}
                onClick={() => decide(r, "accepted")}
                className="flex-1 bg-ink px-3 py-2.5 text-center font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-white disabled:opacity-40"
              >
                Give them the seat
              </button>
              <button
                type="button"
                disabled={busy === r.id}
                onClick={() => decide(r, "declined")}
                className="border border-rule-strong px-3 py-2.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-[color:var(--text-secondary)] disabled:opacity-40"
              >
                Not this time
              </button>
              <span className="shrink-0 font-mono text-[8.5px] uppercase tracking-[0.08em] text-[color:var(--text-quiet)]">
                {askedAgo(r.created_at)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-surface-4 bg-bone px-6 py-4">
        <div className="mono-label mb-1.5">Not everyone is signed off</div>
        <p className="text-[13px] leading-[1.5] text-ink">
          Someone can ask for a seat they have not been evaluated for. You can still give it to them —
          it flags for the prayer room team.
        </p>
      </div>
    </Drawer>
  );
}
