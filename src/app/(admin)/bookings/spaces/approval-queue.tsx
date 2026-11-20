"use client";

// Frame 3c, lower half — "Requests waiting on approval", sitting under the day
// timeline. It lists the pending requests for the DAY on screen, which is why
// it can coexist with the module-wide NeedsYou band above: the band counts
// every outstanding request, this strip is the ones you are looking at.
//
// The page only renders it for someone who can approve, so an empty list here
// means "nothing waiting on this day", never "not allowed". Approving posts to
// the existing decision route, which re-checks the permission server-side —
// this component adds no authority of its own.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SectionBar, StatusPill } from "@/components/ffsa";

export type ApprovalRow = {
  id: string;
  /** The venue being asked for. */
  venue: string;
  /** Date, plus the time range. */
  when: string;
  /** What it is for, and who asked. */
  why: string;
};

export function ApprovalQueue({ initial }: { initial: ApprovalRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function approve(row: ApprovalRow) {
    setBusy(row.id);
    const prev = rows;
    setRows((rs) => rs.filter((r) => r.id !== row.id)); // optimistic
    const res = await fetch(`/api/bookings/${row.id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });
    setBusy(null);
    if (!res.ok) {
      setRows(prev);
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? "Could not approve the request.");
      return;
    }
    toast.success("Request approved.");
    router.refresh();
  }

  return (
    <div className="border border-ink bg-white">
      <SectionBar
        title="Requests waiting on approval"
        meta={rows.length === 1 ? "1 on this day" : `${rows.length} on this day`}
      />

      {rows.length === 0 ? (
        <p className="px-6 py-7 text-center text-[13px] text-[color:var(--text-secondary)]">
          Nothing is waiting on your review for this day.
        </p>
      ) : (
        rows.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule px-5 py-3.5 last:border-b-0 hover:bg-bone md:flex-nowrap md:gap-4 md:px-[22px]"
          >
            <Link
              href={`/bookings/spaces/${row.id}`}
              className="w-full shrink-0 text-[14px] font-bold hover:underline md:w-[200px] md:truncate"
            >
              {row.venue}
            </Link>
            {/* Each field takes its own line on a phone. Sharing one wrapped
                row squeezed the reason down to a single letter. */}
            <div className="w-full shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)] md:w-[230px]">
              {row.when}
            </div>
            <div className="w-full min-w-0 text-[13px] text-[color:var(--text-secondary)] md:flex-1 md:truncate">
              {row.why}
            </div>
            <StatusPill tone="warn">Pending</StatusPill>
            {/* Deny, notes and the clash detail live in the full review queue —
                this is the one-click yes the frame asks for. */}
            <button
              type="button"
              onClick={() => approve(row)}
              disabled={busy === row.id}
              className="shrink-0 border border-ink bg-ink px-2.5 py-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-white hover:bg-[var(--ink-bg-hover)] disabled:opacity-50"
            >
              {busy === row.id ? "…" : "Approve"}
            </button>
          </div>
        ))
      )}
    </div>
  );
}
