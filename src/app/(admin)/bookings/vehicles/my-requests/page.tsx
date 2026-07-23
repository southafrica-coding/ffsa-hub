import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getMyVehicleRequests,
  purposeLabel,
  type VehicleBookingWithRefs,
} from "@/services/vehicles";
import { Plus, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusPill, AssignedVehicles } from "../ui";
import { statusColor } from "@/lib/vehicles/status";
import { dateRangeLabel } from "@/lib/bookings/dates";

export default async function MyVehicleRequestsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await requireModuleAccess(supabase, user.id, "vehicles");
  const { data } = await getMyVehicleRequests(supabase, user.id);
  const mine = (data ?? []) as VehicleBookingWithRefs[];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="page-eyebrow">RESERVATIONS</p>
          <h1 className="page-title">My requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mine.length} request{mine.length === 1 ? "" : "s"} you&apos;ve submitted
          </p>
        </div>
        <Link href="/bookings/vehicles/new">
          <Button size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            New request
          </Button>
        </Link>
      </div>

      {mine.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(22_8%_12%)]">
              <Inbox className="h-5 w-5 text-[hsl(30_6%_42%)]" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No requests yet</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Vehicle requests you submit will show here with their status.
              </p>
            </div>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {mine.map((b) => (
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
