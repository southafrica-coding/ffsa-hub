import Link from "next/link";
import { HOLD_PURPOSE, holdDays } from "@/lib/vehicles/hold";
import { blockEnd } from "@/lib/vehicles/hold";
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
  billableDays, inspectionKindLabel,
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
import { ReturnPanel } from "./return-panel";
import { fmtLong } from "@/lib/vehicles/rental-messages";
import { loadReturnBooking, postRentalState } from "@/lib/vehicles/rental-return";
import { DetailsEditor } from "./details-editor";
import { RequesterMessages } from "./requester-messages";
import {
  getRequesterMessages,
  getBookingConversation,
  isSlackConnected,
} from "@/lib/vehicles/requester-notify";

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ "return-early"?: string }>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
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
        blockEnd(b),
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

  // Each driver's licence + passport page photo. Hub users' live on their
  // profile (that's the whole point — upload once, every booking pulls them);
  // outsiders' are on the driver row. All in the same private bucket — mint
  // signed URLs so they open in one click, but only for the people who run
  // this booking: its requester and the vehicle managers.
  const canSeeDocs =
    access.isAdmin || access.canApprove || access.canManage || b.requested_by === user.id;
  const profileIds = drivers.map((d) => d.user_id).filter((v): v is string => !!v);
  const { data: profileDocs } = profileIds.length
    ? await (admin as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .from("users")
        .select("id, licence_file_url, licence_file_name, passport_file_url, passport_file_name")
        .in("id", profileIds)
    : { data: [] };
  const profileById = new Map(
    ((profileDocs ?? []) as {
      id: string;
      licence_file_url: string | null;
      licence_file_name: string | null;
      passport_file_url: string | null;
      passport_file_name: string | null;
    }[]).map((p) => [p.id, p])
  );
  async function sign(path: string | null, name: string | null) {
    if (!path) return null;
    if (!canSeeDocs) return { file_name: name, signed_url: null };
    const { data: signed } = await admin.storage.from("vehicle-inspections").createSignedUrl(path, 3600);
    return { file_name: name, signed_url: signed?.signedUrl ?? null };
  }
  const driverRows: DriverPanelRow[] = await Promise.all(
    drivers.map(async (d) => {
      const p = d.user_id ? profileById.get(d.user_id) : undefined;
      const [license, passport] = await Promise.all(
        p
          ? [sign(p.licence_file_url, p.licence_file_name), sign(p.passport_file_url, p.passport_file_name)]
          : [sign(d.license_file_url, d.license_file_name), sign(d.passport_file_url, d.passport_file_name)]
      );
      return {
        id: d.id,
        user_id: d.user_id,
        name: d.name,
        phone: d.phone ?? "",
        email: d.email ?? "",
        has_sa_license: d.has_sa_license,
        is_first_time: d.is_first_time,
        driving_test_status: d.driving_test_status,
        license,
        passport,
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
  const days = billableDays(b.checkout_date, b.return_date) // the due-back day isn't counted;
  // Request details are editable only while pending (the API enforces it).
  const canEditDetails = b.status === "pending" && (isManager || isOwner);
  // The return (364): returned, early return, post-rental inspections. Read with the admin
  // client: only names, dates and inspection ids reach the page.
  const rb = await loadReturnBooking(createAdminClient(), b.id).catch(() => null);
  const nameOfUser = async (uid: string | null | undefined) => {
    if (!uid) return "";
    const { data } = await createAdminClient().from("users").select("first_name, preferred_name, last_name").eq("id", uid).maybeSingle();
    return data ? [data.preferred_name || data.first_name, data.last_name].filter(Boolean).join(" ") : "";
  };
  const isDriverUser = driverRows.some((d) => d.user_id === user.id);
  const returnedAt = rb?.returned_at ?? null;
  const returnedLabel = returnedAt
    ? `Returned ${new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Johannesburg" }).format(new Date(returnedAt))}${
        rb?.returned_by ? `, marked by ${await nameOfUser(rb.returned_by)}` : ""
      }`
    : null;
  const post = rb && returnedAt ? await postRentalState(createAdminClient(), rb) : null;
  const todaySA = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());

  const [requesterMessages, conversation, slackConnected] = isManager
    ? await Promise.all([
        getRequesterMessages(b.id),
        getBookingConversation(b.id),
        isSlackConnected(user.id),
      ])
    : [[], [], false];

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

      <div className="max-w-3xl space-y-5 px-5 py-6 md:px-8 md:py-7">
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
          <div className="sm:col-span-2">
            <Field label="Destination">{b.destination ?? "—"}</Field>
          </div>
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
                  destination: b.destination ?? "",
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
      <ReturnPanel
        bookingId={b.id}
        status={b.status}
        dueBack={b.return_date}
        dueBackLabel={fmtLong(b.return_date)}
        today={todaySA}
        returnedLabel={returnedLabel}
        early={
          rb?.early_return_status && rb.early_return_date
            ? { date: rb.early_return_date, label: fmtLong(rb.early_return_date), status: rb.early_return_status, by: (await nameOfUser(rb.early_return_requested_by)) || "Someone" }
            : null
        }
        isManager={isManager}
        isMember={isOwner || isDriverUser}
        inspections={(post?.vehicles ?? []).map((v) => ({ vehicleId: v.id, name: v.name, inspectionId: v.inspectionId }))}
        openEarly={sp["return-early"] === "1"}
        hold={
          rb?.purpose === HOLD_PURPOSE
            ? {
                days: (() => {
                  const h = holdDays({ purpose: rb.purpose, return_date: rb.return_date });
                  return h ? { from: fmtLong(h.from), to: fmtLong(h.to) } : null;
                })(),
                released: rb.hold_released_at
                  ? { by: (await nameOfUser(rb.hold_released_by ?? null)) || "The Vehicle Coordinator", note: rb.hold_release_note ?? "" }
                  : null,
              }
            : null
        }
      />

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
          conversation={conversation}
          slackConnected={slackConnected}
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
