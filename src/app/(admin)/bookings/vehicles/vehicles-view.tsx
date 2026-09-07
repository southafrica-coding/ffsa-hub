import Link from "next/link";
import { Plus, Inbox, ClipboardList, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Masthead, NeedsYou, SectionBar } from "@/components/ffsa";
import { RequestLinkButton } from "./request-link-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusPill, ColorDot, AssignedVehicles } from "./ui";
import { dateRangeLabel } from "@/lib/bookings/dates";
import {
  purposeLabel,
  type VehicleBookingWithRefs,
  type Vehicle,
  type VehicleAccess,
} from "@/services/vehicles";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "completed", label: "Completed" },
  { key: "denied", label: "Denied" },
  { key: "cancelled", label: "Cancelled" },
];

export function VehiclesView({
  bookings,
  vehicles,
  access,
  statusFilter,
  pendingCount,
}: {
  bookings: VehicleBookingWithRefs[];
  vehicles: Vehicle[];
  access: VehicleAccess;
  statusFilter: string;
  pendingCount: number;
}) {
  const activeFleet = vehicles.filter((v) => v.status === "active");

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Reservations"
        title="Rent a Vehicle"
        actions={
          <>
            {(access.canApprove || access.canManage) && (
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
            {(access.canApprove || access.canManage) && <RequestLinkButton />}
            {access.canManage && (
              <Link href="/bookings/vehicles/fleet">
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Settings2 className="h-4 w-4" />
                  Fleet
                </Button>
              </Link>
            )}
            {(access.canRequest || access.canApprove || access.canManage) && (
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

      {/* The page's ONE yellow band, driven by the pending count the page
          already fetches. Never add a second. */}
      {(access.canApprove || access.canManage) && pendingCount > 0 && (
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

      {/* Status filter */}
      <div className="flex flex-wrap items-center border-b border-rule bg-bone px-8 py-3">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/bookings/vehicles" : `/bookings/vehicles?status=${f.key}`}
            className="chip -ml-px bg-white"
            data-active={statusFilter === f.key ? "true" : undefined}
          >
            {f.label}
          </Link>
        ))}
        <span className="mono-label ml-4">
          {bookings.length} booking{bookings.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="space-y-5 px-8 py-7">
      {/* Fleet roster */}
      <div className="border border-ink bg-white">
        <SectionBar
          title="The fleet"
          meta={`${activeFleet.length} active`}
        />
        <div className="flex flex-wrap gap-x-5 gap-y-2 p-5">
          {activeFleet.length === 0 && (
            <span className="text-sm text-[color:var(--text-secondary)]">No active vehicles yet.</span>
          )}
          {activeFleet.map((v) => (
            <span key={v.id} className="inline-flex items-center gap-2 text-sm">
              <ColorDot color={v.color} />
              <span>{v.name}</span>
              <span className="text-xs capitalize text-[color:var(--text-tertiary)]">{v.vehicle_type}</span>
              {v.registration_plate && (
                <span className="font-mono text-[10px] tabular-nums text-[color:var(--text-tertiary)]">
                  {v.registration_plate}
                </span>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* Bookings */}
      {bookings.length === 0 ? (
        <div className="border border-ink bg-white">
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center border border-rule-strong bg-bone">
              <Inbox className="h-5 w-5 text-[color:var(--text-tertiary)]" />
            </div>
            <div>
              <p className="text-sm font-medium">No bookings here</p>
              <p className="mt-0.5 text-xs text-[color:var(--text-secondary)]">
                Vehicle requests will show here with their status.
              </p>
            </div>
            {(access.canRequest || access.canApprove || access.canManage) && (
              <Link href="/bookings/vehicles/new">
                <Button size="sm" className="mt-1 gap-1">
                  <Plus className="h-4 w-4" />
                  New request
                </Button>
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="border border-ink bg-white">
          <SectionBar
            title="Vehicle bookings"
            meta={statusFilter === "all" ? "All statuses" : statusFilter}
          />
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Booking</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Vehicle(s)</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead>Point person</TableHead>
                <TableHead>People</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <StatusPill status={b.status} />
                  </TableCell>
                  <TableCell>
                    <Link href={`/bookings/vehicles/${b.id}`} className="font-medium hover:underline">
                      {b.booking_name}
                    </Link>
                    {b.payment_required && (
                      <span
                        className={
                          "ml-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] " +
                          (b.payment_received ? "text-grass-text" : "text-amber")
                        }
                      >
                        {b.payment_received ? "paid" : "unpaid"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {dateRangeLabel(b.checkout_date, b.return_date)}
                  </TableCell>
                  <TableCell>
                    <AssignedVehicles assignments={b.assignments} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[color:var(--text-secondary)]">
                    {purposeLabel(b.purpose)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {b.point_person ?? <span className="text-[color:var(--text-tertiary)]">—</span>}
                  </TableCell>
                  <TableCell className="tabular-nums text-[color:var(--text-secondary)]">
                    {b.num_people ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
