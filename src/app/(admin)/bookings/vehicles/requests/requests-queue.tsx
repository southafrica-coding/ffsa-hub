"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Check, X, ArrowRight, CheckCircle2 } from "lucide-react";
import { AssignedVehicles } from "../ui";
import { dateRangeLabel } from "@/lib/bookings/dates";
import { purposeLabel, type VehicleBookingWithRefs } from "@/services/vehicles";

function RequestCard({ booking }: { booking: VehicleBookingWithRefs }) {
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
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/bookings/vehicles/${booking.id}`}
              className="font-medium text-foreground hover:text-[hsl(42_95%_62%)]"
            >
              {booking.booking_name}
            </Link>
            {booking.source === "public" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[hsl(150_45%_40%/0.5)] bg-[hsl(150_45%_30%/0.25)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[hsl(150_55%_70%)]">
                External · public link
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {dateRangeLabel(booking.checkout_date, booking.return_date)} ·{" "}
            {purposeLabel(booking.purpose)}
            {booking.num_people ? ` · ${booking.num_people} people` : ""}
          </p>
          <div className="mt-1.5 text-sm">
            <AssignedVehicles assignments={booking.assignments} />
          </div>
          {(booking.requester_name || booking.point_person) && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {booking.requester_name ? `Requested by ${booking.requester_name}` : ""}
              {booking.point_person ? ` · Point person: ${booking.point_person}` : ""}
            </p>
          )}
          {booking.source === "public" && (booking.requester_email || booking.requester_phone) && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {booking.requester_email ?? ""}
              {booking.requester_email && booking.requester_phone ? " · " : ""}
              {booking.requester_phone ?? ""}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => decide("approved")}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] tracking-[0.1em] transition-all hover:brightness-110 disabled:opacity-50"
            style={{ background: "hsl(142 48% 32%)", color: "hsl(142 60% 90%)" }}
          >
            <Check className="h-4 w-4" />
            {busy === "approved" ? "Approving…" : "Approve"}
          </button>
          <button
            type="button"
            onClick={() => decide("denied")}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] tracking-[0.1em] transition-all hover:brightness-110 disabled:opacity-50"
            style={{
              background: "hsl(0 65% 30% / 0.30)",
              color: "hsl(0 75% 78%)",
              borderColor: "hsl(0 70% 52% / 0.4)",
            }}
          >
            <X className="h-4 w-4" />
            {busy === "denied" ? "Denying…" : "Deny"}
          </button>
          <Link href={`/bookings/vehicles/${booking.id}`}>
            <Button size="sm" variant="ghost" className="gap-1 text-muted-foreground">
              Open
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export function RequestsQueue({ requests }: { requests: VehicleBookingWithRefs[] }) {
  if (requests.length === 0) {
    return (
      <div className="rounded-xl border bg-card">
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(142_40%_16%)]">
            <CheckCircle2 className="h-5 w-5 text-[hsl(142_52%_60%)]" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">All caught up</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              No vehicle requests waiting for review.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((b) => (
        <RequestCard key={b.id} booking={b} />
      ))}
    </div>
  );
}
