"use client";

import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, CalendarRange, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { statusColor } from "@/lib/bookings/status";
import { dateRangeLabel, timeRangeLabel, timeLabel } from "@/lib/bookings/dates";
import { StatusPill, ColorDot } from "./ui";
import type { BookingWithRefs } from "@/services/bookings";

export function BookingList({
  bookings,
  clashIds,
  canCreate,
}: {
  bookings: BookingWithRefs[];
  clashIds: Set<string>;
  canCreate: boolean;
}) {
  if (bookings.length === 0) {
    return (
      <div className="rounded-xl border bg-card">
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(22_8%_12%)]">
            <CalendarRange className="h-5 w-5 text-[hsl(30_6%_42%)]" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">No bookings here</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Nothing matches this month and filter. Try another month or clear the filters.
            </p>
          </div>
          {canCreate && (
            <Link href="/bookings/spaces/new">
              <Button size="sm" className="mt-1 gap-1">
                <Plus className="h-4 w-4" />
                New booking
              </Button>
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card overflow-x-auto shadow-[0_2px_16px_rgba(0,0,0,0.35)]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Venue</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Ministry</TableHead>
            <TableHead>Date(s)</TableHead>
            <TableHead>Event time</TableHead>
            <TableHead>Set-up</TableHead>
            <TableHead>Set-down</TableHead>
            <TableHead>Point person</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bookings.map((b) => {
            const clash = clashIds.has(b.id);
            return (
              <TableRow key={b.id}>
                <TableCell style={{ boxShadow: `inset 3px 0 0 ${statusColor(b.status)}` }}>
                  <StatusPill status={b.status} />
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
                    className="font-medium text-foreground hover:text-[hsl(42_95%_62%)] transition-colors"
                  >
                    {b.title}
                  </Link>
                  {b.series_id && (
                    <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-[hsl(42_90%_58%)]">
                      weekly
                    </span>
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
                <TableCell className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    {clash && (
                      <AlertTriangle
                        className="h-3.5 w-3.5 text-[hsl(0_70%_64%)]"
                        aria-label="Clashes with another booking"
                      />
                    )}
                    {dateRangeLabel(b.booking_date, b.end_date)}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {timeRangeLabel(b.start_time, b.end_time)}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {timeLabel(b.setup_time)}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {timeLabel(b.setdown_time)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {b.point_person || <span className="text-muted-foreground">—</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
