import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getBookings,
  getVenues,
  getMinistries,
  getBookingAccess,
  countPendingBookings,
  type BookingWithRefs,
  type Venue,
  type Ministry,
} from "@/services/bookings";
import { parseDateParam, monthGridDays, weekDays } from "@/lib/bookings/dates";
import { BookingsView } from "./bookings-view";

type ViewKind = "month" | "week" | "day" | "list";

function normalizeView(v?: string): ViewKind {
  if (v === "week" || v === "day" || v === "list") return v;
  return "month"; // also handles the legacy "calendar" value
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    date?: string;
    month?: string;
    venue?: string;
    ministry?: string;
    status?: string;
  }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) redirect("/login");

  const [, access] = await Promise.all([
    requireModuleAccess(supabase, user.id, "bookings"),
    getBookingAccess(supabase, user.id),
  ]);

  const view = normalizeView(params.view);
  // Unified focus date; falls back to a legacy ?month, then today.
  const focus = parseDateParam(
    params.date ?? (params.month ? `${params.month}-01` : undefined)
  );
  const year = parseInt(focus.slice(0, 4), 10);
  const month = parseInt(focus.slice(5, 7), 10);

  let from: string;
  let to: string;
  if (view === "week") {
    const wd = weekDays(focus);
    from = wd[0];
    to = wd[6];
  } else if (view === "day") {
    from = focus;
    to = focus;
  } else {
    const grid = monthGridDays(year, month);
    from = grid[0];
    to = grid[grid.length - 1];
  }

  const venueId = params.venue && params.venue !== "all" ? params.venue : undefined;
  const ministryId =
    params.ministry && params.ministry !== "all" ? params.ministry : undefined;

  const [venuesRes, ministriesRes, bookingsRes, pendingCount] = await Promise.all([
    getVenues(supabase),
    getMinistries(supabase),
    // The calendar shows only the confirmed schedule; pending requests live in
    // the manager's review queue, not here.
    getBookings(supabase, { from, to, venueId, ministryId, status: "approved" }),
    countPendingBookings(supabase),
  ]);

  const venues = (venuesRes.data ?? []) as Venue[];
  const ministries = (ministriesRes.data ?? []) as Ministry[];
  const bookings = (bookingsRes.data ?? []) as BookingWithRefs[];

  return (
    <BookingsView
      bookings={bookings}
      venues={venues}
      ministries={ministries}
      access={access}
      view={view}
      date={focus}
      year={year}
      month={month}
      pendingCount={pendingCount}
      filters={{
        venue: params.venue ?? "all",
        ministry: params.ministry ?? "all",
      }}
    />
  );
}
