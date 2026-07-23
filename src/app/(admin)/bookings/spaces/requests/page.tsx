import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getBookingAccess,
  getPendingRequests,
  getBookings,
  type BookingWithRefs,
} from "@/services/bookings";
import { findConflicts, type BookingWindow } from "@/lib/bookings/conflicts";
import { timeRangeLabel } from "@/lib/bookings/dates";
import { RequestsQueue } from "./requests-queue";

export default async function RequestsPage() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) redirect("/login");

  const [, access, pendingRes] = await Promise.all([
    requireModuleAccess(supabase, user.id, "bookings"),
    getBookingAccess(supabase, user.id),
    getPendingRequests(supabase),
  ]);
  if (!access.canApprove) redirect("/bookings/spaces");

  const pending = (pendingRes.data ?? []) as BookingWithRefs[];

  // Flag any request that overlaps an already-approved booking.
  const clashInfo: Record<string, { title: string; time: string }> = {};
  if (pending.length > 0) {
    const dates = pending
      .flatMap((p) => [p.booking_date, p.end_date ?? p.booking_date])
      .sort();
    const { data: approved } = await getBookings(supabase, {
      from: dates[0],
      to: dates[dates.length - 1],
      status: "approved",
    });
    const approvedWindows = (approved ?? []) as BookingWindow[];
    for (const p of pending) {
      const hits = findConflicts(p as unknown as BookingWindow, approvedWindows);
      if (hits.length > 0) {
        const h = hits[0] as BookingWindow & { title?: string };
        clashInfo[p.id] = {
          title: h.title ?? "an approved booking",
          time: timeRangeLabel(h.start_time, h.end_time),
        };
      }
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="page-eyebrow">VENUE SCHEDULING</p>
        <h1 className="page-title">Booking requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {pending.length} request{pending.length === 1 ? "" : "s"} awaiting review — approved ones go onto the calendar.
        </p>
      </div>
      <RequestsQueue initial={pending} clashInfo={clashInfo} />
    </div>
  );
}
