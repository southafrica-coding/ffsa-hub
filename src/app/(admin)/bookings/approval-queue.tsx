"use client";

// Frame 3c, lower half — "Requests waiting on approval", sitting under the day
// timeline. One strip over BOTH services, but each row remembers which service
// it came from, because spaces and vehicles are separate modules with separate
// endpoints and separate permissions.
//
// The page only ever hands over rows for a half the viewer can approve, so an
// empty list here means "nothing waiting", never "not allowed". Approving posts
// to that half's existing decision route, which re-checks the permission
// server-side — this component adds no authority of its own.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SectionBar, StatusPill } from "@/components/ffsa";

export type ApprovalRow = {
  id: string;
  /** Which service — decides the endpoint and the detail link. */
  service: "spaces" | "vehicles";
  /** The venue or vehicle being asked for. */
  resource: string;
  /** Date, plus a time range where the service has one. */
  when: string;
  /** What it is for. */
  why: string;
  href: string;
};

const ENDPOINT: Record<ApprovalRow["service"], (id: string) => string> = {
  spaces: (id) => `/api/bookings/${id}/decision`,
  vehicles: (id) => `/api/vehicles/bookings/${id}/decision`,
};

export function ApprovalQueue({ initial }: { initial: ApprovalRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function approve(row: ApprovalRow) {
    setBusy(row.id);
    const prev = rows;
    setRows((rs) => rs.filter((r) => r.id !== row.id)); // optimistic
    const res = await fetch(ENDPOINT[row.service](row.id), {
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
        meta={rows.length === 1 ? "1 open" : `${rows.length} open`}
      />

      {rows.length === 0 ? (
        <p className="px-6 py-7 text-center text-[13px] text-[color:var(--text-secondary)]">
          Nothing is waiting on your review.
        </p>
      ) : (
        rows.map((row) => (
          <div
            key={`${row.service}:${row.id}`}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule px-5 py-3.5 last:border-b-0 hover:bg-bone md:flex-nowrap md:gap-4 md:px-[22px]"
          >
            <Link
              href={row.href}
              className="w-full shrink-0 text-[14px] font-bold hover:underline md:w-[200px] md:truncate"
            >
              {row.resource}
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
            {/* Deny, notes and the clash detail live in the service's own review
                queue — this is the one-click yes the frame asks for. */}
            <button
              type="button"
              onClick={() => approve(row)}
              disabled={busy === row.id}
              className="shrink-0 border border-ink bg-ink px-2.5 py-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-white hover:bg-[#262622] disabled:opacity-50"
            >
              {busy === row.id ? "…" : "Approve"}
            </button>
          </div>
        ))
      )}
    </div>
  );
}
