import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  Inbox,
  ClipboardList,
  Settings2,
  CalendarRange,
  Table2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Masthead, NeedsYou } from "@/components/ffsa";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getVehicleAccess,
  getVehicleAvailability,
  countPendingVehicleBookings,
} from "@/services/vehicles";
import { parseMonthParam, monthGridDays } from "@/lib/bookings/dates";
import { RequestLinkButton } from "./request-link-button";
import { AvailabilityCalendar } from "./availability-calendar";

/**
 * The vehicles landing page is the availability calendar — counts of free vans
 * and cars per day, and nothing else. Booking rows (who, why, how many people,
 * what status) are the vehicles team's business and live on /board.
 */
export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [, access] = await Promise.all([
    requireModuleAccess(supabase, user.id, "vehicles"),
    getVehicleAccess(supabase, user.id),
  ]);

  const isTeam = access.canApprove || access.canManage;
  const { year, month } = parseMonthParam(params.month);

  // The grid spills into the neighbouring months, so ask for the whole 42 days
  // rather than just this month — otherwise the leading and trailing cells
  // would read as "no fleet".
  const grid = monthGridDays(year, month);

  const [availability, pendingCount] = await Promise.all([
    getVehicleAvailability(supabase, grid[0], grid[grid.length - 1]),
    isTeam ? countPendingVehicleBookings(supabase) : Promise.resolve(0),
  ]);

  const canRequest = access.canRequest || isTeam;
  const hasFleet = Array.from(availability.values()).some(
    (a) => a.vanTotal > 0 || a.carTotal > 0
  );

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Reservations"
        title="Rent a Vehicle"
        actions={
          <>
            <Link href="/bookings/vehicles/my-requests">
              <Button size="sm" variant="outline" className="gap-1.5">
                <CalendarRange className="h-4 w-4" />
                My requests
              </Button>
            </Link>
            {isTeam && (
              <Link href="/bookings/vehicles/board">
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Table2 className="h-4 w-4" />
                  Board
                </Button>
              </Link>
            )}
            {isTeam && (
              <Link href="/bookings/vehicles/requests">
                <Button size="sm" variant="outline" className="gap-1.5">
                  <ClipboardList className="h-4 w-4" />
                  Requests
                  {pendingCount > 0 && (
                    <span className="ml-0.5 border border-ink px-1.5 py-px text-[10px] font-bold">
                      {pendingCount}
                    </span>
                  )}
                </Button>
              </Link>
            )}
            {isTeam && <RequestLinkButton />}
            {access.canManage && (
              <Link href="/bookings/vehicles/fleet/settings">
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Settings2 className="h-4 w-4" />
                  Fleet
                </Button>
              </Link>
            )}
            {canRequest && (
              <Link href="/bookings/vehicles/new">
                <Button size="sm" className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  New request
                </Button>
              </Link>
            )}
          </>
        }
      />

      {/* The page's ONE yellow band. Never add a second. */}
      {isTeam && pendingCount > 0 && (
        <NeedsYou
          action={
            <Link
              href="/bookings/vehicles/requests"
              className="border border-ink bg-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-yellow"
            >
              Review
            </Link>
          }
        >
          {pendingCount === 1
            ? "1 vehicle request is waiting on your review"
            : `${pendingCount} vehicle requests are waiting on your review`}
        </NeedsYou>
      )}

      <div className="space-y-5 px-5 py-6 md:px-8 md:py-7">
        {hasFleet ? (
          <AvailabilityCalendar
            availability={availability}
            year={year}
            month={month}
            canRequest={canRequest}
          />
        ) : (
          <div className="border border-ink bg-white">
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center border border-rule-strong bg-bone">
                <Inbox className="h-5 w-5 text-[color:var(--text-tertiary)]" />
              </div>
              <div>
                <p className="text-sm font-medium">No vehicles in the fleet yet</p>
                <p className="mt-0.5 text-xs text-[color:var(--text-secondary)]">
                  Once vehicles are added, day-by-day availability shows here.
                </p>
              </div>
              {access.canManage && (
                <Link href="/bookings/vehicles/fleet/settings">
                  <Button size="sm" variant="outline" className="mt-1 gap-1">
                    <Settings2 className="h-4 w-4" />
                    Set up the fleet
                  </Button>
                </Link>
              )}
            </div>
          </div>
        )}

        {canRequest && hasFleet && (
          <p className="text-[13px] text-[color:var(--text-secondary)]">
            Pick a day to start a request. Submitting doesn&rsquo;t guarantee a
            vehicle — the Vehicle Coordinator approves each one.
          </p>
        )}
      </div>
    </div>
  );
}
