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
import { Masthead, SectionBar } from "@/components/ffsa";
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
    <div className="ffsa-screen">
      <Masthead
        context="Reservations"
        title="My requests"
        actions={
          <Link href="/bookings/vehicles/new">
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              New request
            </Button>
          </Link>
        }
      />

      <div className="px-5 py-6 md:px-8 md:py-7">
      {mine.length === 0 ? (
        <div className="border border-ink bg-white">
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center border border-rule-strong bg-bone">
              <Inbox className="h-5 w-5 text-[color:var(--text-tertiary)]" />
            </div>
            <div>
              <p className="text-sm font-medium">No requests yet</p>
              <p className="mt-0.5 text-xs text-[color:var(--text-secondary)]">
                Vehicle requests you submit will show here with their status.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="border border-ink bg-white">
          <SectionBar
            title="Submitted by me"
            meta={`${mine.length} request${mine.length === 1 ? "" : "s"}`}
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {mine.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <StatusPill status={b.status} />
                  </TableCell>
                  <TableCell>
                    <Link href={`/bookings/vehicles/${b.id}`} className="font-medium hover:underline">
                      {b.booking_name}
                    </Link>
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
