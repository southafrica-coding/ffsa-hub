"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Check, X, CheckCircle2 } from "lucide-react";
import { SectionBar } from "@/components/ffsa";
import { AssignedVehicles } from "../ui";
import { dateRangeLabel } from "@/lib/bookings/dates";
import { purposeLabel, type VehicleBookingWithRefs } from "@/services/vehicles";

function RequestRow({ booking }: { booking: VehicleBookingWithRefs }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(decision: "approved" | "denied") {
    setBusy(decision);
    try {
      const res = await fetch(`/api/vehicles/bookings/${booking.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBusy(null);
        toast.error(json.error ?? "Could not update the request.");
        return;
      }
      toast.success(decision === "approved" ? "Request approved." : "Request denied.");
      router.refresh();
    } catch {
      setBusy(null);
      toast.error("Network error — please try again.");
    }
  }

  return (
    <TableRow>
      <TableCell>
        <Link href={`/bookings/vehicles/${booking.id}`} className="font-medium hover:underline">
          {booking.booking_name}
        </Link>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {dateRangeLabel(booking.checkout_date, booking.return_date)}
      </TableCell>
      <TableCell>
        <AssignedVehicles assignments={booking.assignments} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-[color:var(--text-secondary)]">
        {purposeLabel(booking.purpose)}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {booking.requester_name || <span className="text-[color:var(--text-tertiary)]">—</span>}
        {/* Nobody in the Hub vouched for this person — worth seeing before
            approving, since their licence arrived as an upload rather than
            from a profile. */}
        {booking.source === "public" && (
          <span className="ml-1.5 border border-rule-strong px-1 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[color:var(--text-secondary)]">
            External
          </span>
        )}
        {booking.destination && (
          <div className="mt-0.5 text-[11px] text-[color:var(--text-tertiary)]">
            Going to: {booking.destination}
          </div>
        )}
        {booking.point_person && (
          <div className="mt-0.5 text-[11px] text-[color:var(--text-tertiary)]">
            Point person: {booking.point_person}
          </div>
        )}
      </TableCell>
      <TableCell className="tabular-nums text-[color:var(--text-secondary)]">
        {booking.num_people ?? "—"}
      </TableCell>
      <TableCell>
        {/* Approve is the black primary, deny the outlined escape — never yellow. */}
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => decide("approved")}
            disabled={!!busy}
            className="inline-flex items-center gap-1 border border-ink bg-ink px-2.5 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {busy === "approved" ? "Approving…" : "Approve"}
          </button>
          <button
            type="button"
            onClick={() => decide("denied")}
            disabled={!!busy}
            className="inline-flex items-center gap-1 border border-destructive px-2.5 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-destructive disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            {busy === "denied" ? "Denying…" : "Deny"}
          </button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function RequestsQueue({ requests }: { requests: VehicleBookingWithRefs[] }) {
  if (requests.length === 0) {
    return (
      <div className="border border-ink bg-white">
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center border border-grass">
            <CheckCircle2 className="h-5 w-5 text-grass-text" />
          </div>
          <div>
            <p className="text-sm font-medium">All caught up</p>
            <p className="mt-0.5 text-xs text-[color:var(--text-secondary)]">
              No vehicle requests waiting for review.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-ink bg-white">
      <SectionBar title="Awaiting review" meta={`${requests.length} pending`} />
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Booking</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Vehicle(s)</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Requested by</TableHead>
              <TableHead>People</TableHead>
              <TableHead className="text-right">Decision</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((b) => (
              <RequestRow key={b.id} booking={b} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
