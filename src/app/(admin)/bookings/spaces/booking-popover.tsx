"use client";

import Link from "next/link";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ArrowUpRight } from "lucide-react";
import { StatusPill, ColorDot } from "./ui";
import { dateRangeLabel, timeRangeLabel, timeLabel } from "@/lib/bookings/dates";
import type { BookingWithRefs } from "@/services/bookings";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="mono-label shrink-0">{label}</span>
      <span className="text-right text-xs">{children}</span>
    </div>
  );
}

/** Click a calendar chip/block to see the booking's details inline. */
export function BookingPopover({
  booking,
  children,
}: {
  booking: BookingWithRefs;
  children: React.ReactNode;
}) {
  const hasSetup = booking.setup_time || booking.setdown_time;
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 overflow-hidden p-0">
        <div
          className="border-b border-rule bg-bone p-3"
          style={{ borderLeft: `3px solid ${booking.venue?.color ?? "#64748b"}` }}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold leading-tight">{booking.title}</p>
            <StatusPill status={booking.status} />
          </div>
          <p className="mt-0.5 text-[11px] text-[color:var(--text-secondary)]">
            {booking.venue?.name ?? "Venue"}
            {booking.venue?.building ? ` · ${booking.venue.building}` : ""}
          </p>
        </div>

        <div className="space-y-1.5 p-3">
          <Row label="Date">
            {dateRangeLabel(booking.booking_date, booking.end_date)}
            {booking.series_id && <span className="mono-label ml-1">weekly</span>}
          </Row>
          <Row label="Event time">
            {timeRangeLabel(booking.start_time, booking.end_time)}
          </Row>
          {hasSetup && (
            <Row label="Set-up / down">
              {timeLabel(booking.setup_time)} – {timeLabel(booking.setdown_time)}
            </Row>
          )}
          {booking.ministry && (
            <Row label="Ministry">
              <span className="inline-flex items-center gap-1.5">
                <ColorDot color={booking.ministry.color} className="h-2 w-2" />
                {booking.ministry.name}
              </span>
            </Row>
          )}
          <Row label="Requested by">{booking.requester_name || "—"}</Row>
          {booking.point_person && <Row label="Point person">{booking.point_person}</Row>}
          {booking.description && (
            <p className="mt-1.5 border-t border-rule pt-1.5 text-[11px] leading-snug text-[color:var(--text-secondary)]">
              {booking.description}
            </p>
          )}
        </div>

        <div className="border-t border-ink">
          <Link
            href={`/bookings/spaces/${booking.id}`}
            className="flex items-center justify-center gap-1 bg-ink px-2 py-2.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] !text-white"
          >
            Open full details
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
