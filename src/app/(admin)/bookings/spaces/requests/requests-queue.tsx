"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Check, X, AlertTriangle, ClipboardCheck } from "lucide-react";
import { SectionBar } from "@/components/ffsa";
import { cn } from "@/lib/utils/cn";
import { ColorDot } from "../ui";
import { dateRangeLabel, timeRangeLabel, timeLabel } from "@/lib/bookings/dates";
import type { BookingWithRefs } from "@/services/bookings";

export function RequestsQueue({
  initial,
  clashInfo,
}: {
  initial: BookingWithRefs[];
  clashInfo: Record<string, { title: string; time: string }>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(id: string, decision: "approved" | "denied") {
    setBusy(id);
    const prev = rows;
    setRows((rs) => rs.filter((r) => r.id !== id)); // optimistic — row leaves the queue
    const res = await fetch(`/api/bookings/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    setBusy(null);
    if (!res.ok) {
      setRows(prev);
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? "Could not update the request.");
      return;
    }
    toast.success(decision === "approved" ? "Request approved." : "Request denied.");
    router.refresh();
  }

  if (rows.length === 0) {
    return (
      <div className="border border-ink bg-white">
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center border border-grass">
            <ClipboardCheck className="h-5 w-5 text-grass-text" />
          </div>
          <div>
            <p className="text-sm font-medium">All caught up</p>
            <p className="mt-0.5 text-xs text-[color:var(--text-secondary)]">
              No requests are waiting for review.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-ink bg-white">
      <SectionBar title="Awaiting review" meta={`${rows.length} pending`} />
      <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date(s)</TableHead>
            <TableHead>Venue</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Ministry</TableHead>
            <TableHead>Event time</TableHead>
            <TableHead>Set-up</TableHead>
            <TableHead>Requested by</TableHead>
            <TableHead className="text-right">Decision</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((b) => {
            const clash = clashInfo[b.id];
            return (
              <TableRow key={b.id}>
                <TableCell
                  // A clashing request is marked by a red edge on the row, not a fill.
                  className={cn(
                    "whitespace-nowrap border-l-[3px] border-l-transparent",
                    clash && "border-l-destructive"
                  )}
                >
                  <Link
                    href={`/bookings/spaces?view=day&date=${b.booking_date}`}
                    className="hover:underline"
                    title="See the schedule for this day"
                  >
                    {dateRangeLabel(b.booking_date, b.end_date)}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5 text-foreground">
                    <ColorDot color={b.venue?.color ?? "#64748b"} />
                    {b.venue?.name ?? "—"}
                  </span>
                </TableCell>
                <TableCell>
                  <Link href={`/bookings/spaces/${b.id}`} className="font-medium hover:underline">
                    {b.title}
                  </Link>
                  {b.series_id && <span className="mono-label ml-1.5">weekly</span>}
                  {clash && (
                    <div className="mt-1 inline-flex items-center gap-1 border border-destructive px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      Overlaps approved: {clash.title} · {clash.time}
                    </div>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {b.ministry ? (
                    <span className="inline-flex items-center gap-1.5">
                      <ColorDot color={b.ministry.color} />
                      {b.ministry.name}
                    </span>
                  ) : (
                    <span className="text-[color:var(--text-tertiary)]">—</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {timeRangeLabel(b.start_time, b.end_time)}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {timeLabel(b.setup_time)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {b.requester_name || <span className="text-[color:var(--text-tertiary)]">—</span>}
                </TableCell>
                <TableCell>
                  {/* The decision pair: approve is the black primary, deny is the
                      outlined escape. Neither is ever yellow. */}
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => decide(b.id, "approved")}
                      disabled={!!busy}
                      className="inline-flex items-center gap-1 border border-ink bg-ink px-2.5 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => decide(b.id, "denied")}
                      disabled={!!busy}
                      className="inline-flex items-center gap-1 border border-destructive px-2.5 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-destructive disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      Deny
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}
