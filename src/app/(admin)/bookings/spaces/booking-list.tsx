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
import { SectionBar } from "@/components/ffsa";
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
      <div className="border border-ink bg-white">
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center border border-rule-strong bg-bone">
            <CalendarRange className="h-5 w-5 text-[color:var(--text-tertiary)]" />
          </div>
          <div>
            <p className="text-sm font-medium">No bookings here</p>
            <p className="mt-0.5 text-xs text-[color:var(--text-secondary)]">
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
    <div className="border border-ink bg-white">
      <SectionBar
        title="Confirmed bookings"
        meta={`${bookings.length} in view`}
      />
      <div className="overflow-x-auto">
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
                <TableCell>
                  <StatusPill status={b.status} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <ColorDot color={b.venue?.color ?? "#64748b"} />
                    {b.venue?.name ?? "—"}
                  </span>
                </TableCell>
                <TableCell>
                  <Link href={`/bookings/spaces/${b.id}`} className="font-medium hover:underline">
                    {b.title}
                  </Link>
                  {b.series_id && (
                    <span className="mono-label ml-1.5">weekly</span>
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
                <TableCell className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    {clash && (
                      <AlertTriangle
                        className="h-3.5 w-3.5 text-destructive"
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
                  {b.point_person || <span className="text-[color:var(--text-tertiary)]">—</span>}
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
