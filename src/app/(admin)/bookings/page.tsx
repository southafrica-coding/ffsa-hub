// Frame 3c — BOOKINGS. "Spaces and vehicles on one timeline for the day, so
// clashes are obvious at a glance. Requests waiting on approval sit underneath."
//
// This route used to be a hub of two description cards with the day timeline as
// a read-only strip beneath them. The timeline IS the screen now; the two
// services are still reachable from the control strip, because the global nav
// only carries one Bookings entry.
//
// THE RULE THAT SHAPES THIS FILE: spaces and vehicles are separate services
// with separate permission modules. Every read below is fetched and gated per
// half, and a half the viewer cannot see contributes nothing — no rows, no
// requests, no heading, no error. `safe()` also means one half failing cannot
// take the other half's screen down.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAnyModuleAccess, hasModuleAccess } from "@/lib/require-permission";
import {
  getBookings,
  getVenues,
  getBookingAccess,
  type BookingWithRefs,
  type Venue,
} from "@/services/bookings";
import {
  getVehicleBookings,
  getVehicles,
  getVehicleAccess,
  purposeLabel,
  type Vehicle,
  type VehicleBookingWithRefs,
} from "@/services/vehicles";
import { blockWindow, computeHourRange } from "@/lib/bookings/timegrid";
import { todayISO, parseDateParam, dateRangeLabel, timeRangeLabel } from "@/lib/bookings/dates";
import type { TimelineItem, TimelineResource } from "./day-timeline";
import type { ApprovalRow } from "./approval-queue";
import { BookingsDay, type Showing } from "./bookings-day";

// Only live bookings occupy a resource — denied / cancelled ones never clash,
// and a completed vehicle trip has already been handed back.
const LIVE_STATUSES = new Set(["pending", "approved"]);

const FALLBACK_COLOR = "#64748b"; // the same fallback the spaces day view uses

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

function normalizeShowing(v?: string): Showing {
  return v === "spaces" || v === "vehicles" ? v : "all";
}

/** Never let one half's failure take the page down. */
async function safe<T>(load: () => Promise<T>, enabled: boolean, empty: T): Promise<T> {
  if (!enabled) return empty;
  try {
    return await load();
  } catch {
    return empty;
  }
}

/* ── Spaces half ──────────────────────────────────────────── */

/**
 * Every active venue is a lane, booked or not — on a screen whose job is "can I
 * have this room at 3", a free room has to be visible. A venue that has been
 * deactivated but still has a live booking today keeps its lane, so nothing
 * silently drops off the grid.
 */
async function loadSpaces(
  supabase: Client,
  date: string
): Promise<{ resources: TimelineResource[]; bookings: BookingWithRefs[] }> {
  const [venuesRes, bookingsRes] = await Promise.all([
    getVenues(supabase, { activeOnly: true }),
    getBookings(supabase, { from: date, to: date }),
  ]);

  const venues = (venuesRes.data ?? []) as Venue[];
  const bookings = (bookingsRes.data ?? []) as BookingWithRefs[];

  const rows = new Map<string, TimelineResource & { sort: number }>();
  const put = (
    id: string,
    name: string,
    building: string | null,
    color: string,
    sort: number
  ) => {
    const key = `venue:${id}`;
    if (!rows.has(key)) {
      rows.set(key, {
        key,
        name,
        kind: "Space",
        meta: building,
        color: color || FALLBACK_COLOR,
        items: [],
        sort,
      });
    }
    return rows.get(key)!;
  };

  for (const v of venues) put(v.id, v.name, v.building, v.color, v.sort_order ?? 9999);

  for (const b of bookings) {
    if (!LIVE_STATUSES.has(b.status)) continue;

    // No clock window ⇒ a full-width lane block instead of a zero-width sliver.
    // Two cases: a booking with no times at all (the spaces form's "all day"),
    // and a multi-day booking merely passing through this date. Date-only
    // strings are compared as strings, never parsed into a Date, so nothing can
    // shift a day.
    const multiDay = !!b.end_date && b.end_date > b.booking_date;
    const window = multiDay ? null : blockWindow(b);

    const item: TimelineItem = {
      id: b.id,
      title: b.title,
      href: `/bookings/spaces/${b.id}`,
      status: b.status,
      timeLabel: window ? timeRangeLabel(b.start_time, b.end_time) : "All day",
      window,
    };

    const row = put(
      b.venue_id,
      b.venue?.name ?? "Unnamed space",
      b.venue?.building ?? null,
      b.venue?.color ?? FALLBACK_COLOR,
      b.venue?.sort_order ?? 9999
    );
    row.items.push(item);
  }

  return {
    resources: [...rows.values()].sort(
      (a, b) => a.sort - b.sort || a.name.localeCompare(b.name)
    ),
    bookings,
  };
}

/* ── Vehicles half ────────────────────────────────────────── */

/**
 * One lane per active vehicle. Vehicle bookings are date-only in the schema
 * (checkout_date → return_date, no times anywhere), so every one of them is an
 * all-day block by definition — which is exactly why a van already out shows as
 * a clash against anything else booked on it that day.
 */
async function loadVehicles(
  supabase: Client,
  date: string
): Promise<{ resources: TimelineResource[]; bookings: VehicleBookingWithRefs[] }> {
  const [fleetRes, bookingsRes] = await Promise.all([
    getVehicles(supabase, { activeOnly: true }),
    getVehicleBookings(supabase, { from: date, to: date }),
  ]);

  const fleet = (fleetRes.data ?? []) as Vehicle[];
  const bookings = (bookingsRes.data ?? []) as VehicleBookingWithRefs[];

  const rows = new Map<string, TimelineResource & { sort: number }>();
  const put = (
    key: string,
    name: string,
    meta: string | null,
    color: string,
    sort: number
  ) => {
    if (!rows.has(key)) {
      rows.set(key, {
        key,
        name,
        kind: "Vehicle",
        meta,
        color: color || FALLBACK_COLOR,
        items: [],
        sort,
      });
    }
    return rows.get(key)!;
  };

  for (const v of fleet)
    put(`vehicle:${v.id}`, v.name, v.registration_plate, v.color, v.sort_order ?? 9999);

  for (const b of bookings) {
    if (!LIVE_STATUSES.has(b.status)) continue;

    const item: TimelineItem = {
      id: b.id,
      title: b.booking_name,
      href: `/bookings/vehicles/${b.id}`,
      status: b.status,
      timeLabel: "All day",
      window: null,
    };

    const assigned = (b.assignments ?? [])
      .map((a) => a.vehicle)
      .filter((v): v is NonNullable<typeof v> => !!v);

    if (assigned.length === 0) {
      // A request that has not been given a van yet still occupies the day — it
      // gets its own lane rather than vanishing from the view.
      put("vehicle:unassigned", "Awaiting a vehicle", null, FALLBACK_COLOR, 10_000)
        .items.push(item);
      continue;
    }
    for (const v of assigned) {
      put(
        `vehicle:${v.id}`,
        v.name,
        v.registration_plate,
        v.color ?? FALLBACK_COLOR,
        9999
      ).items.push(item);
    }
  }

  return {
    resources: [...rows.values()].sort(
      (a, b) => a.sort - b.sort || a.name.localeCompare(b.name)
    ),
    bookings,
  };
}

/* ── Screen ───────────────────────────────────────────────── */

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; show?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireAnyModuleAccess(supabase, user.id, ["bookings", "vehicles"]);

  // The two modules are asked independently. Everything downstream branches off
  // these two booleans and nothing else.
  const [canSpaces, canVehicles] = await Promise.all([
    hasModuleAccess(supabase, user.id, "bookings"),
    hasModuleAccess(supabase, user.id, "vehicles"),
  ]);

  const today = todayISO();
  const date = parseDateParam(params.date);
  const showing = normalizeShowing(params.show);

  // A filter value the viewer has no access to must not blank the screen, so it
  // can only ever narrow what they were already allowed to see.
  const wantSpaces = canSpaces && showing !== "vehicles";
  const wantVehicles = canVehicles && showing !== "spaces";

  const [spaces, vehicles, spaceAccess, vehicleAccess] = await Promise.all([
    safe(() => loadSpaces(supabase, date), wantSpaces, {
      resources: [] as TimelineResource[],
      bookings: [] as BookingWithRefs[],
    }),
    safe(() => loadVehicles(supabase, date), wantVehicles, {
      resources: [] as TimelineResource[],
      bookings: [] as VehicleBookingWithRefs[],
    }),
    safe(() => getBookingAccess(supabase, user.id), canSpaces, null),
    safe(() => getVehicleAccess(supabase, user.id), canVehicles, null),
  ]);

  // Spaces first, then vehicles — the frame has no group headings, so the order
  // plus each lane's own "SPACE" / "VEHICLE" line is what separates them. It is
  // also why a viewer with one module sees no trace of the other.
  const resources = [...spaces.resources, ...vehicles.resources];

  // Hour bounds from the timed half only: an all-day lane contributes no window
  // and so never stretches the day open.
  const { startHour, endHour } = computeHourRange(
    spaces.bookings
      .filter((b) => LIVE_STATUSES.has(b.status))
      .map((b) => (b.end_date && b.end_date > b.booking_date ? null : blockWindow(b))),
    7,
    19
  );

  // Approvals: only for a half this viewer can approve, and only for a half the
  // filter is currently showing.
  const approvals: ApprovalRow[] = [];
  if (wantSpaces && spaceAccess?.canApprove) {
    for (const b of spaces.bookings) {
      if (b.status !== "pending") continue;
      approvals.push({
        id: b.id,
        service: "spaces",
        resource: b.venue?.name ?? "Unnamed space",
        when: `${dateRangeLabel(b.booking_date, b.end_date)} · ${timeRangeLabel(
          b.start_time,
          b.end_time
        )}`,
        why: [b.title, b.requester_name].filter(Boolean).join(" — "),
        href: `/bookings/spaces/${b.id}`,
      });
    }
  }
  if (wantVehicles && vehicleAccess?.canApprove) {
    for (const b of vehicles.bookings) {
      if (b.status !== "pending") continue;
      const named = (b.assignments ?? [])
        .map((a) => a.vehicle?.name)
        .filter(Boolean)
        .join(", ");
      approvals.push({
        id: b.id,
        service: "vehicles",
        resource: named || "Awaiting a vehicle",
        when: dateRangeLabel(b.checkout_date, b.return_date),
        why: [b.booking_name, purposeLabel(b.purpose)].filter(Boolean).join(" — "),
        href: `/bookings/vehicles/${b.id}`,
      });
    }
  }
  // Anyone who can approve at least one half gets the strip, so "nothing
  // waiting" is a statement rather than a blank space.
  const showApprovals =
    (wantSpaces && !!spaceAccess?.canApprove) ||
    (wantVehicles && !!vehicleAccess?.canApprove);


  return (
    <BookingsDay
      date={date}
      today={today}
      showing={showing}
      resources={resources}
      startHour={startHour}
      endHour={endHour}
      approvals={approvals}
      showApprovals={showApprovals}
      canSpaces={canSpaces}
      canVehicles={canVehicles}
      canBookSpace={canSpaces && !!spaceAccess?.canRequest}
      canBookVehicle={canVehicles && !!vehicleAccess?.canRequest}
    />
  );
}
