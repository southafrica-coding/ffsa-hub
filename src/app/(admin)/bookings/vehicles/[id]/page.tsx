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
import { StatusPill, AssignedVehicles } from "../ui";
import { Masthead, SectionBar } from "@/components/ffsa";
import { dateRangeLabel } from "@/lib/bookings/dates";
import { countries } from "@/lib/countries";
import { VehicleBookingActions } from "./booking-actions";
import { DriversPanel, type DriverPanelRow } from "./drivers-panel";
import { DetailsEditor } from "./details-editor";
import { RequesterMessages } from "./requester-messages";
import { getRequesterMessages } from "@/lib/vehicles/requester-notify";

function countryLabel(iso2: string | null): string {
  if (!iso2) return "—";
  const c = countries.find((x) => x.iso2 === iso2);
  return c ? `${c.flag} ${c.name}` : iso2;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mono-label">{label}</p>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

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
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-3 last:border-b-0 last:pb-0">
      <div>
        <p className="text-sm font-medium">{inspectionKindLabel(kind)}</p>
        {insp ? (
          <p className="mt-0.5 text-xs text-[color:var(--text-secondary)]">
            {insp.mileage != null ? `${insp.mileage.toLocaleString()} km · ` : ""}
            recorded {insp.performed_at.slice(0, 10)}
            {kind === "collection" && insp.damage_panels.length > 0
              ? ` · ${insp.damage_panels.length} panel(s) flagged`
              : ""}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-[color:var(--text-secondary)]">Not recorded yet.</p>
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
      <p className="mono-label mb-1.5">{title}</p>
      <ul className="space-y-1">
        {files.map((f) => (
          <li key={f.id} className="flex items-center gap-2 text-sm">
            <Icon className="h-4 w-4 shrink-0 text-[color:var(--text-tertiary)]" />
            {f.signed_url ? (
              <a
                href={f.signed_url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
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
      getOverlappingAssignments(
        createAdminClient(),
        b.checkout_date,
        b.return_date,
        b.id
      ),
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

  // Per-driver licences live on the driver row as an object path in the same
  // private bucket — mint signed URLs so they render on first paint.
  const driverRows: DriverPanelRow[] = await Promise.all(
    drivers.map(async (d) => {
      let signedUrl: string | null = null;
      if (d.license_file_url) {
        const { data: signed } = await admin.storage
          .from("vehicle-inspections")
          .createSignedUrl(d.license_file_url, 3600);
        signedUrl = signed?.signedUrl ?? null;
      }
      return {
        id: d.id,
        user_id: d.user_id,
        name: d.name,
        phone: d.phone ?? "",
        has_sa_license: d.has_sa_license,
        is_first_time: d.is_first_time,
        driving_test_status: d.driving_test_status,
        license: d.license_file_url
          ? { file_name: d.license_file_name, signed_url: signedUrl }
          : null,
      };
    })
  );

  const isManager = access.isAdmin || access.canApprove || access.canManage;
  const isOwner = b.requested_by === user.id;
  const canInspect = isManager || isOwner;
  // Drivers and licences stay editable after approval; the requester loses
  // access once the booking is closed, managers never do.
  const canEditDrivers =
    isManager || (isOwner && b.status !== "completed" && b.status !== "cancelled");
  const days = dayCount(b.checkout_date, b.return_date);
  // Request details are editable only while pending (the API enforces it).
  const canEditDetails = b.status === "pending" && (isManager || isOwner);
  const requesterMessages = isManager ? await getRequesterMessages(b.id) : [];

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Reservations"
        title={b.booking_name}
        actions={
          <>
            <StatusPill status={b.status} />
          </>
        }
      />

      <div className="max-w-3xl space-y-5 px-8 py-7">
      <p className="text-[13px] text-[color:var(--text-secondary)]">
        {dateRangeLabel(b.checkout_date, b.return_date)} · {days} day
        {days === 1 ? "" : "s"} · {purposeLabel(b.purpose)}
        {b.purpose === "other" && b.purpose_note ? ` (${b.purpose_note})` : ""}
      </p>

      {/* Details */}
      <div className="border border-ink bg-white">
        <SectionBar title="Request" />
        <div className="grid grid-cols-1 gap-5 p-6 sm:grid-cols-2">
          <Field label="Requested by">{b.requester_name ?? "—"}</Field>
          <Field label="Point person">{b.point_person ?? "—"}</Field>
          <Field label="Email">{b.requester_email ?? "—"}</Field>
          <Field label="WhatsApp">{b.requester_phone ?? "—"}</Field>
          <Field label="People">{b.num_people ?? "—"}</Field>
          <Field label="Home country / Xero">
            {countryLabel(b.home_country)}
            <span className="ml-1 text-xs text-[color:var(--text-tertiary)]">
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
          {canEditDetails && (
            <div className="sm:col-span-2">
              <DetailsEditor
                bookingId={b.id}
                notifiesRequester={!isOwner}
                initial={{
                  booking_name: b.booking_name ?? "",
                  point_person: b.point_person ?? "",
                  purpose: b.purpose ?? "",
                  purpose_note: b.purpose_note ?? "",
                  requester_phone: b.requester_phone ?? "",
                  num_people: b.num_people != null ? String(b.num_people) : "",
                  checkout_date: b.checkout_date,
                  return_date: b.return_date,
                  notes: b.notes ?? "",
                }}
              />
            </div>
          )}
          {isManager && b.status === "approved" && (
            <p className="text-xs text-[color:var(--text-secondary)] sm:col-span-2">
              To change dates or details, move this booking back to pending under Manage booking.
            </p>
          )}
        </div>
      </div>

      {/* Drivers */}
      <DriversPanel
        bookingId={b.id}
        initialDrivers={driverRows}
        canEdit={canEditDrivers}
        canRecordTest={isManager}
      />

      {/* Payment summary (read-only mirror; managed below) */}
      {b.payment_required && (
        <div className="border border-ink bg-white">
          <SectionBar title="Payment" />
          <div className="grid grid-cols-2 gap-5 p-6 sm:grid-cols-3">
            <Field label="Price / day">
              {b.pricing_per_day != null ? `${b.currency} ${b.pricing_per_day}` : "—"}
            </Field>
            <Field label="Total">
              {b.total_amount != null ? `${b.currency} ${b.total_amount}` : "—"}
            </Field>
            <Field label="Payment">
              <span className={b.payment_received ? "text-grass-text" : "text-amber"}>
                {b.payment_received ? "Received ✓" : "Outstanding"}
              </span>
            </Field>
          </div>
        </div>
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
      <div className="border border-ink bg-white">
        <SectionBar title="Inspections" />
        <div className="space-y-4 p-6">
          <InspectionRow kind="collection" insp={collection} bookingId={b.id} canInspect={canInspect} />
          <InspectionRow kind="return" insp={returnInsp} bookingId={b.id} canInspect={canInspect} />
          <FileLinks title="Damage / condition photos" icon={Camera} files={photos} />
          <FileLinks title="Driver licences" icon={FileText} files={licenses} />
        </div>
      </div>

      {/* Policy agreement */}
      <div className="border border-ink bg-white">
        <SectionBar title="Policy agreement" />
        <div className="space-y-3 p-6">
          {latestAgreement ? (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-grass-text" />
              <span className="font-medium">{latestAgreement.signer_name}</span>
              <span className="text-[color:var(--text-secondary)]">
                signed {latestAgreement.signed_at.slice(0, 10)} · policy {latestAgreement.policy_version}
              </span>
            </p>
          ) : (
            <p className="text-sm text-[color:var(--text-secondary)]">Not signed yet.</p>
          )}
          {canInspect && (
            <Link href={`/bookings/vehicles/${b.id}/agreement`}>
              <Button size="sm" variant="outline" className="gap-1.5">
                <PenLine className="h-4 w-4" />
                {latestAgreement ? "View / re-sign" : "Sign policy"}
              </Button>
            </Link>
          )}
        </div>
      </div>

      {isManager && (
        <RequesterMessages
          bookingId={b.id}
          requesterName={b.requester_name}
          rows={requesterMessages}
        />
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
    </div>
  );
}
