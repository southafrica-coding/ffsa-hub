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

// The day timeline is the module's own visual and its landing view; month,
// week and list sit behind the switcher.
function normalizeView(v?: string): ViewKind {
  if (v === "week" || v === "month" || v === "list") return v;
  return "day"; // also handles the legacy "calendar" value
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
  const rawDate = params.date ?? (params.month ? `${params.month}-01` : undefined);
  const focus = parseDateParam(rawDate);
  // Whether the viewer actually asked for this date. When they did not, `focus`
  // is the SERVER's today — UTC on Vercel — which is not necessarily theirs.
  // The view corrects it against the browser clock; see bookings-view.tsx.
  const dateWasChosen = !!rawDate;
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
    // The month / week / list views show only the confirmed schedule; pending
    // requests live in the manager's review queue, not there. The day timeline
    // is the exception: a pending request that clashes with a confirmed one is
    // exactly what that screen exists to show, so it takes both.
    getBookings(supabase, {
      from,
      to,
      venueId,
      ministryId,
      status: view === "day" ? undefined : "approved",
    }),
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
      dateWasChosen={dateWasChosen}
      filters={{
        venue: params.venue ?? "all",
        ministry: params.ministry ?? "all",
      }}
    />
  );
}
