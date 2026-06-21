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
import { ColorDot } from "../ui";
import { dateRangeLabel, timeRangeLabel, timeLabel } from "@/lib/bookings/dates";
import type { BookingWithRefs } from "@/services/bookings";

export function RequestsQueue({
  initial,
  clashInfo,
}: {
  initial: BookingWithRefs[];
  clashInfo: Record<string, string>;
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
      <div className="rounded-xl border bg-card">
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(142_50%_22%/0.3)]">
            <ClipboardCheck className="h-5 w-5 text-[hsl(142_52%_62%)]" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">All caught up</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              No requests are waiting for review.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card overflow-x-auto shadow-[0_2px_16px_rgba(0,0,0,0.35)]">
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
                <TableCell className="whitespace-nowrap">
                  <Link
                    href={`/bookings/spaces?view=day&date=${b.booking_date}`}
                    className="hover:text-[hsl(42_95%_62%)]"
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
                  <Link
                    href={`/bookings/spaces/${b.id}`}
                    className="font-medium text-foreground hover:text-[hsl(42_95%_62%)]"
                  >
                    {b.title}
                  </Link>
                  {b.series_id && (
                    <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-[hsl(42_90%_58%)]">
                      weekly
                    </span>
                  )}
                  {clash && (
                    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[hsl(0_70%_66%)]">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      Clashes with {clash}
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
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {timeRangeLabel(b.start_time, b.end_time)}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {timeLabel(b.setup_time)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {b.requester_name || <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => decide(b.id, "approved")}
                      disabled={!!busy}
                      className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[10px] tracking-[0.08em] transition-all hover:brightness-110 disabled:opacity-50"
                      style={{ background: "hsl(142 48% 32%)", color: "hsl(142 60% 90%)" }}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => decide(b.id, "denied")}
                      disabled={!!busy}
                      className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[10px] tracking-[0.08em] transition-all hover:brightness-110 disabled:opacity-50"
                      style={{
                        background: "hsl(0 65% 30% / 0.30)",
                        color: "hsl(0 75% 78%)",
                        borderColor: "hsl(0 70% 52% / 0.4)",
                      }}
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
  );
}
