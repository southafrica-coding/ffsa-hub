import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getBookingById,
  getSeriesById,
  countBookingsInSeries,
  getVenueBookingsBetween,
  getBookingAccess,
} from "@/services/bookings";
import { AlertTriangle, Pencil, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Masthead, SectionBar } from "@/components/ffsa";
import { ColorDot } from "../ui";
import { BookingStatusProvider, LiveStatusPill } from "./status-context";
import {
  dateRangeLabel,
  timeRangeLabel,
  timeLabel,
  humanDate,
} from "@/lib/bookings/dates";
import { weekdayLabel } from "@/lib/bookings/recurrence";
import { findConflicts, type BookingWindow } from "@/lib/bookings/conflicts";
import { callerLeadsBookingMinistry } from "@/lib/auth/check-ministry-access";
import { BookingActions } from "./booking-actions";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mono-label">{label}</p>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) redirect("/login");

  const [, access, bookingRes] = await Promise.all([
    requireModuleAccess(supabase, user.id, "bookings"),
    getBookingAccess(supabase, user.id),
    getBookingById(supabase, id),
  ]);

  const booking = bookingRes.data;
  if (bookingRes.error || !booking) notFound();

  // Names for requested-by / decided-by.
  const userIds = [booking.requested_by, booking.decided_by].filter(Boolean);
  const { data: userRows } = userIds.length
    ? await supabase
        .from("users")
        .select("id,first_name,last_name,email")
        .in("id", userIds)
    : { data: [] as { id: string; first_name: string | null; last_name: string | null; email: string | null }[] };

  const nameOf = (uid: string | null): string | null => {
    if (!uid) return null;
    const u = (userRows ?? []).find((r) => r.id === uid);
    if (!u) return null;
    return [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email || null;
  };

  // Recurring series context.
  let series = null as Awaited<ReturnType<typeof getSeriesById>>["data"];
  let seriesCount = 0;
  if (booking.series_id) {
    const [seriesRes, count] = await Promise.all([
      getSeriesById(supabase, booking.series_id),
      countBookingsInSeries(supabase, booking.series_id),
    ]);
    series = seriesRes.data;
    seriesCount = count;
  }

  // Clash check for this booking.
  const from = booking.booking_date;
  const to = booking.end_date ?? booking.booking_date;
  const { data: others } = await getVenueBookingsBetween(
    supabase,
    booking.venue_id,
    from,
    to
  );
  const clashes = findConflicts(
    booking as unknown as BookingWindow,
    (others ?? []) as BookingWindow[]
  );

  const isOwner = booking.requested_by === user.id;
  const isMinistryLeader = await callerLeadsBookingMinistry(
    supabase,
    user.id,
    booking.ministry?.staff_ministry_id
  );
  const canCancel =
    access.isAdmin || access.canManage || access.canApprove || isOwner || isMinistryLeader;
  const canEdit =
    canCancel && (booking.status === "pending" || booking.status === "approved");
  const isClosed = booking.status === "cancelled";
  // Reaching the series is about permission, not about this one date's status —
  // a cancelled date is often exactly where you go looking for the series.
  const isSeriesMinistryLeader =
    !!series &&
    (await callerLeadsBookingMinistry(supabase, user.id, series.ministry?.staff_ministry_id));
  const canEditSeries =
    !!series &&
    (access.isAdmin ||
      access.canManage ||
      access.canApprove ||
      series.created_by === user.id ||
      isSeriesMinistryLeader);
  const seriesHref = series ? `/bookings/spaces/series/${series.id}/edit` : "";

  return (
    <BookingStatusProvider initialStatus={booking.status}>
    <div className="ffsa-screen">
      <Masthead
        context={`${booking.venue?.name ?? "Venue"}${booking.venue?.building ? ` · ${booking.venue.building}` : ""}`}
        title={booking.title}
        actions={
          <>
            <LiveStatusPill />
            {canEdit && (
              <Link href={`/bookings/spaces/${booking.id}/edit`}>
                <Button variant="outline" size="sm" className="gap-1">
                  <Pencil className="h-3.5 w-3.5" />
                  Edit this date
                </Button>
              </Link>
            )}
            {canEditSeries && (
              <Link href={seriesHref}>
                <Button variant="outline" size="sm" className="gap-1">
                  <Repeat className="h-3.5 w-3.5" />
                  Edit series
                </Button>
              </Link>
            )}
          </>
        }
      />

      <div className="max-w-3xl space-y-5 px-5 py-6 md:px-8 md:py-7">
      {clashes.length > 0 && !isClosed && (
        <div className="border border-destructive p-3 text-sm">
          <p className="flex items-center gap-2 font-semibold text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Clashes with {clashes.length} other booking{clashes.length === 1 ? "" : "s"} in this venue
          </p>
          <ul className="mt-1.5 space-y-0.5 text-[color:var(--text-secondary)]">
            {clashes.slice(0, 6).map((c) => (
              <li key={c.id}>
                {humanDate(c.booking_date)} —{" "}
                <Link href={`/bookings/spaces/${c.id}`} className="font-medium hover:underline">
                  {(c as { title?: string }).title ?? "another booking"}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border border-ink bg-white">
        <SectionBar title="Booking" />
        <div className="grid grid-cols-2 gap-5 p-6 sm:grid-cols-3">
          <Field label="Date(s)">
            {dateRangeLabel(booking.booking_date, booking.end_date)}
          </Field>
          <Field label="Event time">
            {timeRangeLabel(booking.start_time, booking.end_time)}
          </Field>
          <Field label="Ministry">
            {booking.ministry ? (
              <span className="inline-flex items-center gap-1.5">
                <ColorDot color={booking.ministry.color} />
                {booking.ministry.name}
              </span>
            ) : (
              <span className="text-[color:var(--text-tertiary)]">—</span>
            )}
          </Field>
          <Field label="Set-up">{timeLabel(booking.setup_time)}</Field>
          <Field label="Set-down">{timeLabel(booking.setdown_time)}</Field>
          <Field label="Point person">
            {booking.point_person || <span className="text-[color:var(--text-tertiary)]">—</span>}
          </Field>
          <Field label="Requested by">
            {nameOf(booking.requested_by) ||
              booking.requester_name || <span className="text-[color:var(--text-tertiary)]">—</span>}
          </Field>
          {booking.description && (
            <div className="col-span-2 sm:col-span-3">
              <Field label="Description">{booking.description}</Field>
            </div>
          )}
          {series && (
            <div className="col-span-2 sm:col-span-3">
              <Field label="Recurring series">
                Every {(series.interval_weeks ?? 1) > 1 ? "other " : ""}{weekdayLabel(series.weekday)} · {dateRangeLabel(series.series_start, series.series_end)}
                <span className="text-[color:var(--text-tertiary)]"> · {seriesCount} date{seriesCount === 1 ? "" : "s"} in this series</span>
                {canEditSeries && (
                  <Link href={seriesHref} className="mt-1 block font-medium hover:underline">
                    Change the day or the run of dates →
                  </Link>
                )}
              </Field>
            </div>
          )}
          {(booking.decided_at || booking.decision_note) && (
            <div className="col-span-2 border border-rule bg-bone p-3 sm:col-span-3">
              <Field
                label={
                  booking.status === "approved"
                    ? "Approved"
                    : booking.status === "denied"
                      ? "Denied"
                      : "Decision"
                }
              >
                {nameOf(booking.decided_by) ? (
                  <span>By {nameOf(booking.decided_by)}</span>
                ) : null}
                {booking.decision_note ? (
                  <span className="mt-0.5 block text-[color:var(--text-secondary)]">
                    “{booking.decision_note}”
                  </span>
                ) : null}
              </Field>
            </div>
          )}
        </div>
      </div>

      <BookingActions
        bookingId={booking.id}
        hasSeries={!!booking.series_id}
        canApprove={access.canApprove}
        canCancel={canCancel}
        venueName={booking.venue?.name ?? null}
      />
      </div>
    </div>
    </BookingStatusProvider>
  );
}
