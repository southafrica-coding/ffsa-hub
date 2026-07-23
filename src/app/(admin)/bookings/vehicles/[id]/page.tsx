import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect, notFound } from "next/navigation";
import { ClipboardCheck, Camera, FileText, PenLine, CheckCircle2 } from "lucide-react";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getVehicleBookingById,
  getVehicles,
  getVehicleAccess,
  getOverlappingAssignments,
  getInspectionsForBooking,
  getInspectionFiles,
  getVehiclePaymentsForBooking,
  getAgreementsForBooking,
  purposeLabel,
  dayCount,
  inspectionKindLabel,
  type Vehicle,
  type VehicleBookingWithRefs,
  type VehicleDriver,
  type VehicleInspection,
  type VehicleInspectionFile,
  type VehiclePayment,
  type VehicleAgreement,
} from "@/services/vehicles";
import { Button } from "@/components/ui/button";
import { PaymentBlock } from "../payment-block";
import { Card, CardContent } from "@/components/ui/card";
import { StatusPill, AssignedVehicles } from "../ui";
import { statusColor } from "@/lib/vehicles/status";
import { dateRangeLabel } from "@/lib/bookings/dates";
import { countries } from "@/lib/countries";
import { VehicleBookingActions } from "./booking-actions";

function countryLabel(iso2: string | null): string {
  if (!iso2) return "—";
  const c = countries.find((x) => x.iso2 === iso2);
  return c ? `${c.flag} ${c.name}` : iso2;
}

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

function InspectionRow({
  kind,
  insp,
  bookingId,
  canInspect,
}: {
  kind: "collection" | "return";
  insp: VehicleInspection | null;
  bookingId: string;
  canInspect: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-b-0 last:pb-0">
      <div>
        <p className="text-sm font-medium text-foreground">{inspectionKindLabel(kind)}</p>
        {insp ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {insp.mileage != null ? `${insp.mileage.toLocaleString()} km · ` : ""}
            recorded {insp.performed_at.slice(0, 10)}
            {kind === "collection" && insp.damage_panels.length > 0
              ? ` · ${insp.damage_panels.length} panel(s) flagged`
              : ""}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-muted-foreground">Not recorded yet.</p>
        )}
      </div>
      {canInspect && (
        <Link
          href={`/bookings/vehicles/${bookingId}/${kind === "collection" ? "collect" : "return"}`}
        >
          <Button size="sm" variant="outline" className="gap-1.5">
            <ClipboardCheck className="h-4 w-4" />
            {insp ? "Update" : "Record"}
          </Button>
        </Link>
      )}
    </div>
  );
}

function FileLinks({
  title,
  icon: Icon,
  files,
}: {
  title: string;
  icon: typeof Camera;
  files: { id: string; file_name: string | null; signed_url: string | null }[];
}) {
  if (files.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[hsl(30_6%_46%)]">
        {title}
      </p>
      <ul className="space-y-1">
        {files.map((f) => (
          <li key={f.id} className="flex items-center gap-2 text-sm">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            {f.signed_url ? (
              <a
                href={f.signed_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground hover:text-[hsl(42_95%_62%)]"
              >
                {f.file_name ?? "file"}
              </a>
            ) : (
              <span>{f.file_name ?? "file"}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

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

  const [vehiclesRes, overlapping, inspectionsRes, filesRes, paymentsRes, agreementsRes] =
    await Promise.all([
      getVehicles(supabase, { activeOnly: true }),
      getOverlappingAssignments(supabase, b.checkout_date, b.return_date, b.id),
      getInspectionsForBooking(supabase, b.id),
      getInspectionFiles(supabase, b.id),
      getVehiclePaymentsForBooking(supabase, b.id),
      getAgreementsForBooking(supabase, b.id),
    ]);
  const payments = (paymentsRes.data ?? []) as VehiclePayment[];
  const latestPayment = payments[0] ?? null;
  const agreements = (agreementsRes.data ?? []) as VehicleAgreement[];
  const latestAgreement = agreements[0] ?? null;
  const vehicles = (vehiclesRes.data ?? []) as Vehicle[];
  const unavailableIds = Array.from(new Set(overlapping.map((a) => a.vehicle_id)));
  const assignedIds = (b.assignments ?? [])
    .map((a) => a.vehicle?.id)
    .filter(Boolean) as string[];
  const drivers = (b.drivers ?? []) as VehicleDriver[];

  const inspections = (inspectionsRes.data ?? []) as VehicleInspection[];
  const collection = inspections.find((i) => i.kind === "collection") ?? null;
  const returnInsp = inspections.find((i) => i.kind === "return") ?? null;

  const admin = createAdminClient();
  const files = await Promise.all(
    ((filesRes.data ?? []) as VehicleInspectionFile[]).map(async (f) => {
      const { data: signed } = await admin.storage
        .from("vehicle-inspections")
        .createSignedUrl(f.file_path, 3600);
      return { ...f, signed_url: signed?.signedUrl ?? null };
    })
  );
  const photos = files.filter((f) => f.kind === "damage_photo");
  const licenses = files.filter((f) => f.kind === "license");

  const isManager = access.isAdmin || access.canApprove || access.canManage;
  const isOwner = b.requested_by === user.id;
  const canInspect = isManager || isOwner;
  const days = dayCount(b.checkout_date, b.return_date);

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="page-eyebrow">RESERVATIONS</p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="page-title">{b.booking_name}</h1>
            {b.source === "public" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[hsl(150_45%_40%/0.5)] bg-[hsl(150_45%_30%/0.25)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[hsl(150_55%_70%)]">
                External · public link
              </span>
            )}
          </div>
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
          <Field label="Home country / Xero">
            {countryLabel(b.home_country)}
            <span className="ml-1 text-xs text-muted-foreground">
              ({(b.home_country ?? "").toUpperCase() === "US" ? "US" : "SA"} Xero)
            </span>
          </Field>
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

      {/* Card payment + Xero */}
      {b.payment_required && (
        <PaymentBlock
          bookingId={b.id}
          paymentReceived={b.payment_received}
          total={b.total_amount}
          currency={b.currency}
          latestStatus={latestPayment?.status ?? null}
          xeroInvoiceNumber={latestPayment?.xero_invoice_number ?? null}
          canPay={isManager || isOwner}
        />
      )}

      {/* Inspections */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
            Inspections
          </h2>
          <InspectionRow kind="collection" insp={collection} bookingId={b.id} canInspect={canInspect} />
          <InspectionRow kind="return" insp={returnInsp} bookingId={b.id} canInspect={canInspect} />
          <FileLinks title="Damage / condition photos" icon={Camera} files={photos} />
          <FileLinks title="Driver licences" icon={FileText} files={licenses} />
        </CardContent>
      </Card>

      {/* Policy agreement */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <PenLine className="h-4 w-4 text-muted-foreground" />
            Policy agreement
          </h2>
          {latestAgreement ? (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4" style={{ color: "hsl(142 52% 60%)" }} />
              <span className="font-medium text-foreground">{latestAgreement.signer_name}</span>
              <span className="text-muted-foreground">
                signed {latestAgreement.signed_at.slice(0, 10)} · policy {latestAgreement.policy_version}
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Not signed yet.</p>
          )}
          {canInspect && (
            <Link href={`/bookings/vehicles/${b.id}/agreement`}>
              <Button size="sm" variant="outline" className="gap-1.5">
                <PenLine className="h-4 w-4" />
                {latestAgreement ? "View / re-sign" : "Sign policy"}
              </Button>
            </Link>
          )}
        </CardContent>
      </Card>

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
          home_country: b.home_country,
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
