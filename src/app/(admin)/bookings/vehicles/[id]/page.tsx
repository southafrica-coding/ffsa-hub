import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getVehicleBookingById,
  getVehicles,
  getVehicleAccess,
  getOverlappingAssignments,
  purposeLabel,
  dayCount,
  type Vehicle,
  type VehicleBookingWithRefs,
  type VehicleDriver,
} from "@/services/vehicles";
import { Card, CardContent } from "@/components/ui/card";
import { StatusPill, AssignedVehicles } from "../ui";
import { statusColor } from "@/lib/vehicles/status";
import { dateRangeLabel } from "@/lib/bookings/dates";
import { VehicleBookingActions } from "./booking-actions";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[hsl(30_6%_46%)]">
        {label}
      </p>
      <div className="mt-0.5 text-sm text-foreground">{children}</div>
    </div>
  );
}

const TEST_LABEL: Record<string, string> = {
  not_required: "No test needed",
  pending: "Test pending",
  passed: "Test passed",
  failed: "Test failed",
};

export default async function VehicleBookingDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [, access] = await Promise.all([
    requireModuleAccess(supabase, user.id, "vehicles"),
    getVehicleAccess(supabase, user.id),
  ]);

  const { data: booking } = await getVehicleBookingById(supabase, id);
  if (!booking) notFound();
  const b = booking as VehicleBookingWithRefs;

  const [vehiclesRes, overlapping] = await Promise.all([
    getVehicles(supabase, { activeOnly: true }),
    getOverlappingAssignments(supabase, b.checkout_date, b.return_date, b.id),
  ]);
  const vehicles = (vehiclesRes.data ?? []) as Vehicle[];
  const unavailableIds = Array.from(new Set(overlapping.map((a) => a.vehicle_id)));
  const assignedIds = (b.assignments ?? [])
    .map((a) => a.vehicle?.id)
    .filter(Boolean) as string[];
  const drivers = (b.drivers ?? []) as VehicleDriver[];

  const isManager = access.isAdmin || access.canApprove || access.canManage;
  const isOwner = b.requested_by === user.id;
  const days = dayCount(b.checkout_date, b.return_date);

  return (
    <div className="space-y-5 max-w-3xl">
      <Link
        href="/bookings/vehicles"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to bookings
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="page-eyebrow">RESERVATIONS</p>
          <h1 className="page-title">{b.booking_name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {dateRangeLabel(b.checkout_date, b.return_date)} · {days} day
            {days === 1 ? "" : "s"} · {purposeLabel(b.purpose)}
            {b.purpose === "other" && b.purpose_note ? ` (${b.purpose_note})` : ""}
          </p>
        </div>
        <span style={{ boxShadow: `inset 0 -2px 0 ${statusColor(b.status)}` }}>
          <StatusPill status={b.status} />
        </span>
      </div>

      {/* Details */}
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 pt-6 sm:grid-cols-2">
          <Field label="Requested by">{b.requester_name ?? "—"}</Field>
          <Field label="Point person">{b.point_person ?? "—"}</Field>
          <Field label="Email">{b.requester_email ?? "—"}</Field>
          <Field label="WhatsApp">{b.requester_phone ?? "—"}</Field>
          <Field label="People">{b.num_people ?? "—"}</Field>
          <Field label="Assigned vehicles">
            <AssignedVehicles assignments={b.assignments} />
          </Field>
          {b.notes && (
            <div className="sm:col-span-2">
              <Field label="Notes">{b.notes}</Field>
            </div>
          )}
          {b.decision_note && (
            <div className="sm:col-span-2">
              <Field label="Decision note">{b.decision_note}</Field>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Drivers */}
      {drivers.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-3 text-sm font-semibold">Drivers</h2>
            <div className="space-y-2">
              {drivers.map((d) => (
                <div
                  key={d.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-2 text-sm last:border-b-0 last:pb-0"
                >
                  <span className="font-medium text-foreground">{d.name}</span>
                  {d.phone && <span className="text-muted-foreground">{d.phone}</span>}
                  <span
                    className="text-xs"
                    style={{ color: d.has_sa_license ? "hsl(142 52% 60%)" : "hsl(0 70% 66%)" }}
                  >
                    {d.has_sa_license ? "SA licence ✓" : "No licence on file"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {TEST_LABEL[d.driving_test_status] ?? d.driving_test_status}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payment summary (read-only mirror; managed below) */}
      {b.payment_required && (
        <Card>
          <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-3">
            <Field label="Price / day">
              {b.pricing_per_day != null ? `${b.currency} ${b.pricing_per_day}` : "—"}
            </Field>
            <Field label="Total">
              {b.total_amount != null ? `${b.currency} ${b.total_amount}` : "—"}
            </Field>
            <Field label="Payment">
              <span style={{ color: b.payment_received ? "hsl(142 52% 60%)" : "hsl(42 90% 62%)" }}>
                {b.payment_received ? "Received ✓" : "Outstanding"}
              </span>
            </Field>
          </CardContent>
        </Card>
      )}

      {/* Management */}
      <VehicleBookingActions
        booking={{
          id: b.id,
          status: b.status,
          checkout_date: b.checkout_date,
          return_date: b.return_date,
          pricing_per_day: b.pricing_per_day,
          total_amount: b.total_amount,
          currency: b.currency,
          payment_required: b.payment_required,
          payment_received: b.payment_received,
        }}
        vehicles={vehicles}
        assignedIds={assignedIds}
        unavailableIds={unavailableIds}
        days={days}
        isManager={isManager}
        isOwner={isOwner}
      />
    </div>
  );
}
