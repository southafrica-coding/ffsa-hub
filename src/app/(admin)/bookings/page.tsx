import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  requireAnyModuleAccess,
  hasModuleAccess,
} from "@/lib/require-permission";
import { Building2, Car, ArrowUpRight } from "lucide-react";
import { Masthead, SectionBar } from "@/components/ffsa";
import { getBookings, type BookingWithRefs } from "@/services/bookings";
import {
  getVehicleBookings,
  type VehicleBookingWithRefs,
} from "@/services/vehicles";
import { blockWindow, computeHourRange } from "@/lib/bookings/timegrid";
import {
  todayISO,
  dayHeadingLabel,
  timeRangeLabel,
} from "@/lib/bookings/dates";
import {
  DayTimeline,
  type TimelineGroup,
  type TimelineItem,
  type TimelineRow,
} from "./day-timeline";

const BOOKING_TYPES = [
  {
    title: "Space Bookings",
    description:
      "Request and approve venue & space bookings across FFSA — calendar, recurring slots, and approvals.",
    href: "/bookings/spaces",
    icon: Building2,
    ready: true,
    module: "bookings",
  },
  {
    title: "Rent a Vehicle",
    description:
      "Request a base vehicle for outreach, airport runs, and ministry trips — fleet, drivers, and approvals.",
    href: "/bookings/vehicles",
    icon: Car,
    ready: true,
    module: "vehicles",
  },
];

// Only live bookings occupy a resource — denied / cancelled ones never clash,
// and a "completed" vehicle trip has already been handed back.
const LIVE_STATUSES = new Set(["pending", "approved"]);

const FALLBACK_COLOR = "#64748b"; // same fallback the spaces day view uses

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/**
 * Space bookings covering today, grouped into one row per venue that is
 * actually in use. Rows for venues with nothing today are omitted rather than
 * drawn empty, so the hub stays short on a quiet day.
 *
 * Runs ONLY for a user with bookings access, on the same request-scoped client
 * as every other bookings read — RLS is unchanged and nobody's reach widens.
 */
async function loadSpaceRows(supabase: Client, today: string): Promise<TimelineRow[]> {
  const { data, error } = await getBookings(supabase, { from: today, to: today });
  if (error) return [];

  const rows = new Map<string, TimelineRow & { sort: number }>();
  for (const b of (data ?? []) as BookingWithRefs[]) {
    if (!LIVE_STATUSES.has(b.status)) continue;

    // No clock window ⇒ the timeline draws a full-width lane block instead of
    // a zero-width sliver. Two cases: a booking with no times at all (the
    // "All day" concept in the spaces form), and a multi-day booking that
    // merely passes through today. Date-only strings are compared as strings —
    // never parsed into a Date — so nothing can shift a day.
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

    let row = rows.get(b.venue_id);
    if (!row) {
      row = {
        key: `venue:${b.venue_id}`,
        label: b.venue?.name ?? "Unnamed space",
        meta: b.venue?.building ?? null,
        color: b.venue?.color ?? FALLBACK_COLOR,
        items: [],
        sort: b.venue?.sort_order ?? 9999,
      };
      rows.set(b.venue_id, row);
    }
    row.items.push(item);
  }

  return [...rows.values()].sort(
    (a, b) => a.sort - b.sort || a.label.localeCompare(b.label)
  );
}

/**
 * Vehicle bookings covering today, one row per assigned vehicle. Vehicle
 * bookings are date-only in the schema (checkout_date → return_date, no times
 * anywhere), so every one of them is an all-day lane block by definition.
 */
async function loadVehicleRows(supabase: Client, today: string): Promise<TimelineRow[]> {
  const { data, error } = await getVehicleBookings(supabase, { from: today, to: today });
  if (error) return [];

  const rows = new Map<string, TimelineRow & { sort: number }>();
  for (const b of (data ?? []) as VehicleBookingWithRefs[]) {
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

    // A request that hasn't been given a van yet still occupies the day — it
    // gets its own lane rather than vanishing from the view.
    const targets = assigned.length
      ? assigned.map((v) => ({
          key: `vehicle:${v.id}`,
          label: v.name,
          meta: v.registration_plate,
          color: v.color ?? FALLBACK_COLOR,
          sort: 0,
        }))
      : [
          {
            key: "vehicle:unassigned",
            label: "Awaiting a vehicle",
            meta: null,
            color: FALLBACK_COLOR,
            sort: 1,
          },
        ];

    for (const t of targets) {
      let row = rows.get(t.key);
      if (!row) {
        row = { ...t, items: [] };
        rows.set(t.key, row);
      }
      row.items.push(item);
    }
  }

  return [...rows.values()].sort(
    (a, b) => a.sort - b.sort || a.label.localeCompare(b.label)
  );
}

/** Never let one half's failure take the page down — a half that errors is
 *  simply not on the timeline. */
async function safeRows(
  load: () => Promise<TimelineRow[]>,
  enabled: boolean
): Promise<TimelineRow[]> {
  if (!enabled) return [];
  try {
    return await load();
  } catch {
    return [];
  }
}

export default async function BookingsHubPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireAnyModuleAccess(supabase, user.id, ["bookings", "vehicles"]);

  // Only surface the booking types the user can actually open — Space Bookings
  // is restricted to ministry leaders / booking-admin roles, so vehicle-only
  // staff shouldn't see a card that would just redirect them out.
  const access = await Promise.all(
    BOOKING_TYPES.map((b) => hasModuleAccess(supabase, user.id, b.module))
  );
  const bookingTypes = BOOKING_TYPES.filter((_, i) => access[i]);

  // The two halves of the day timeline are fetched independently and gated on
  // the SAME module access that decides whether the hub card is shown. A user
  // with vehicles but not spaces gets vehicle rows only — no error, and no
  // empty "Spaces" heading, because an empty half is never put in `groups`.
  const canSpaces = access[BOOKING_TYPES.findIndex((b) => b.module === "bookings")];
  const canVehicles = access[BOOKING_TYPES.findIndex((b) => b.module === "vehicles")];

  const today = todayISO(); // local calendar day, same helper the spaces views use
  const [spaceRows, vehicleRows] = await Promise.all([
    safeRows(() => loadSpaceRows(supabase, today), canSpaces),
    safeRows(() => loadVehicleRows(supabase, today), canVehicles),
  ]);

  const groups: TimelineGroup[] = [];
  if (spaceRows.length) groups.push({ key: "spaces", label: "Spaces", rows: spaceRows });
  if (vehicleRows.length)
    groups.push({ key: "vehicles", label: "Vehicles", rows: vehicleRows });

  // Hour window: the same helper the spaces day view uses, so both screens
  // agree on where a block sits. All-day rows contribute no window and so
  // never stretch the range.
  const { startHour, endHour } = computeHourRange(
    spaceRows.flatMap((r) => r.items.map((i) => i.window)),
    7,
    19
  );

  return (
    <div className="ffsa-screen">
      <Masthead context="Reservations" title="Bookings" />

      {/* Frame 3c — spaces and vehicles on one day timeline so a clash reads at
          a glance. Read-only: every block links back to its own module. */}
      {(canSpaces || canVehicles) && (
        <div className="px-5 pt-6 md:px-8 md:pt-7">
          <div className="border border-ink bg-white">
            <SectionBar title="Today" meta={dayHeadingLabel(today)} />
            {groups.length > 0 ? (
              <DayTimeline groups={groups} startHour={startHour} endHour={endHour} />
            ) : (
              <p className="px-6 py-8 text-center text-[13px] text-[color:var(--text-secondary)]">
                Nothing booked today.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="px-5 py-6 md:px-8 md:py-7">
        <div className="border border-ink">
          {bookingTypes.map((b) => {
            const Icon = b.icon;
            const body = (
              <div className="flex items-start gap-4 border-b border-rule px-6 py-6 last:border-b-0">
                <Icon className="mt-1 h-5 w-5 shrink-0 text-[color:var(--text-tertiary)]" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-[22px]">{b.title}</h2>
                  <p className="mt-1.5 max-w-2xl text-[13px] text-[color:var(--text-secondary)]">
                    {b.description}
                  </p>
                </div>
                {b.ready ? (
                  <span className="mono-label flex shrink-0 items-center gap-1 pt-1">
                    Open <ArrowUpRight className="h-3 w-3" />
                  </span>
                ) : (
                  <span className="mono-label shrink-0 pt-1">Soon</span>
                )}
              </div>
            );

            if (b.ready) {
              return (
                <Link
                  key={b.title}
                  href={b.href}
                  className="block transition-colors hover:bg-bone"
                >
                  {body}
                </Link>
              );
            }
            return (
              <div key={b.title} className="opacity-50">
                {body}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
