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
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, AlertTriangle, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookingStatusProvider, LiveStatusPill } from "./status-context";
import {
  dateRangeLabel,
  timeRangeLabel,
  timeLabel,
  humanDate,
} from "@/lib/bookings/dates";
import { weekdayLabel } from "@/lib/bookings/recurrence";
import { findConflicts, type BookingWindow } from "@/lib/bookings/conflicts";
import { BookingActions } from "./booking-actions";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="mt-0.5 text-sm">{children}</div>
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
  const canCancel =
    access.isAdmin || access.canManage || access.canApprove || isOwner;
  const canEdit =
    canCancel && (booking.status === "pending" || booking.status === "approved");
  const isClosed = booking.status === "cancelled";

  return (
    <BookingStatusProvider initialStatus={booking.status}>
    <div className="max-w-3xl space-y-5">
      <Link
        href="/bookings/spaces"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to bookings
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <span
            className="mt-1.5 h-11 w-1 shrink-0 rounded-full"
            style={{ backgroundColor: booking.venue?.color ?? "#64748b" }}
          />
          <div>
            <p className="page-eyebrow">
              {booking.venue?.name ?? "Venue"}
              {booking.venue?.building ? (
                <span className="text-[hsl(30_6%_34%)]"> · {booking.venue.building}</span>
              ) : null}
            </p>
            <h1 className="page-title">{booking.title}</h1>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <LiveStatusPill className="text-[11px] px-2.5 py-1" />
          {canEdit && (
            <Link href={`/bookings/spaces/${booking.id}/edit`}>
              <Button variant="outline" size="sm" className="h-7 gap-1">
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            </Link>
          )}
        </div>
      </div>

      {clashes.length > 0 && !isClosed && (
        <div className="rounded-lg border border-primary/35 bg-primary/10 p-3 text-sm">
          <p className="flex items-center gap-2 font-semibold text-primary">
            <AlertTriangle className="h-4 w-4" />
            Clashes with {clashes.length} other booking{clashes.length === 1 ? "" : "s"} in this venue
          </p>
          <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
            {clashes.slice(0, 6).map((c) => (
              <li key={c.id}>
                {humanDate(c.booking_date)} —{" "}
                <Link href={`/bookings/spaces/${c.id}`} className="font-medium text-foreground hover:underline">
                  {(c as { title?: string }).title ?? "another booking"}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Card>
        <CardContent className="pt-6 grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Field label="Date(s)">
            {dateRangeLabel(booking.booking_date, booking.end_date)}
          </Field>
          <Field label="Event time">
            {timeRangeLabel(booking.start_time, booking.end_time)}
          </Field>
          <Field label="Ministry">
            {booking.ministry ? (
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: booking.ministry.color }}
                />
                {booking.ministry.name}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Field>
          <Field label="Set-up">{timeLabel(booking.setup_time)}</Field>
          <Field label="Set-down">{timeLabel(booking.setdown_time)}</Field>
          <Field label="Point person">
            {booking.point_person || <span className="text-muted-foreground">—</span>}
          </Field>
          <Field label="Requested by">
            {nameOf(booking.requested_by) ||
              booking.requester_name || <span className="text-muted-foreground">—</span>}
          </Field>
          {booking.description && (
            <div className="col-span-2 sm:col-span-3">
              <Field label="Description">{booking.description}</Field>
            </div>
          )}
          {series && (
            <div className="col-span-2 sm:col-span-3">
              <Field label="Recurring series">
                Every {weekdayLabel(series.weekday)} · {dateRangeLabel(series.series_start, series.series_end)}
                <span className="text-muted-foreground"> · {seriesCount} date{seriesCount === 1 ? "" : "s"} in this series</span>
              </Field>
            </div>
          )}
          {(booking.decided_at || booking.decision_note) && (
            <div className="col-span-2 sm:col-span-3 rounded-md border bg-muted/30 p-3">
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
                  <span className="block text-muted-foreground mt-0.5">
                    “{booking.decision_note}”
                  </span>
                ) : null}
              </Field>
            </div>
          )}
        </CardContent>
      </Card>

      <BookingActions
        bookingId={booking.id}
        hasSeries={!!booking.series_id}
        canApprove={access.canApprove}
        canCancel={canCancel}
      />
    </div>
    </BookingStatusProvider>
  );
}
