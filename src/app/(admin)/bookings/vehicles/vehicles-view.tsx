import Link from "next/link";
import { Plus, Inbox, ClipboardList, Settings2, Car } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusPill, ColorDot, AssignedVehicles } from "./ui";
import { statusColor } from "@/lib/vehicles/status";
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
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="page-eyebrow">RESERVATIONS</p>
          <h1 className="page-title">Rent a Vehicle</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {bookings.length} booking{bookings.length === 1 ? "" : "s"}
            {statusFilter !== "all" ? ` · ${statusFilter}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(access.canApprove || access.canManage) && (
            <Link href="/bookings/vehicles/requests">
              <Button size="sm" variant="outline" className="gap-1.5">
                <ClipboardList className="h-4 w-4" />
                Requests
                {pendingCount > 0 && (
                  <span
                    className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold"
                    style={{ background: "hsl(42 95% 55% / 0.18)", color: "hsl(42 90% 66%)" }}
                  >
                    {pendingCount}
                  </span>
                )}
              </Button>
            </Link>
          )}
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
        </div>
      </div>

      {/* Fleet roster */}
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Car className="h-4 w-4 text-muted-foreground" />
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[hsl(30_6%_46%)]">
            The fleet
          </span>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {activeFleet.length === 0 && (
            <span className="text-sm text-muted-foreground">No active vehicles yet.</span>
          )}
          {activeFleet.map((v) => (
            <span key={v.id} className="inline-flex items-center gap-2 text-sm">
              <ColorDot color={v.color} />
              <span className="text-foreground">{v.name}</span>
              <span className="text-xs text-muted-foreground capitalize">{v.vehicle_type}</span>
              {v.registration_plate && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {v.registration_plate}
                </span>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => {
          const active = statusFilter === f.key;
          return (
            <Link
              key={f.key}
              href={f.key === "all" ? "/bookings/vehicles" : `/bookings/vehicles?status=${f.key}`}
              className="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
              style={
                active
                  ? { background: "hsl(42 95% 55% / 0.14)", color: "hsl(42 95% 64%)", borderColor: "hsl(42 95% 55% / 0.4)" }
                  : { color: "hsl(30 6% 60%)" }
              }
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {/* Bookings */}
      {bookings.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(22_8%_12%)]">
              <Inbox className="h-5 w-5 text-[hsl(30_6%_42%)]" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No bookings here</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
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
        <div className="rounded-xl border bg-card overflow-x-auto shadow-[0_2px_16px_rgba(0,0,0,0.35)]">
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
                  <TableCell style={{ boxShadow: `inset 3px 0 0 ${statusColor(b.status)}` }}>
                    <StatusPill status={b.status} />
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/bookings/vehicles/${b.id}`}
                      className="font-medium text-foreground hover:text-[hsl(42_95%_62%)]"
                    >
                      {b.booking_name}
                    </Link>
                    {b.payment_required && (
                      <span
                        className="ml-1.5 text-[9px] font-bold uppercase tracking-wider"
                        style={{ color: b.payment_received ? "hsl(142 52% 60%)" : "hsl(42 90% 60%)" }}
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
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {purposeLabel(b.purpose)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {b.point_person ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {b.num_people ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
