import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEventById } from "@/services/events";
import { getRegistrationsForEvent } from "@/services/registrations";
import { getAttendanceForEvent } from "@/services/attendance";
import { getEventOutcomes } from "@/services/event-outcomes";
import { getEventRoles } from "@/services/event-roles";
import { getCachedActiveLabels } from "@/lib/cached-reads";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OutcomesManager } from "./outcomes-manager";
import { RolesRoster } from "./roles-roster";
import { BaseLabelPicker } from "./base-label-picker";
import { FormsTab } from "./forms-tab";
import { WorkflowsManager } from "./workflows-manager";
import { OutcomeFormLink } from "./outcome-form-link";
import { fieldKey, type FormSchema, type FormField } from "@/lib/forms/schema";
import { EventLogo } from "./event-logo";
import { EventStatusControl } from "./event-status-control";
import { EventDetailsForm } from "./event-details-form";
import { TicketsTab } from "./tickets-tab";
import { OrdersTab } from "./orders-tab";
import { CheckInTab } from "./check-in-tab";
import {
  listTicketTypesByEvent,
  listPromoCodesByEvent,
  listOrdersByEvent,
  listAttendanceTicketsByEvent,
  getActiveFeeProfiles,
} from "@/services/ticketing";
import type { FeeProfile } from "@/lib/payments/pricing";

const TABS = [
  { key: "details", label: "Details & Roles" },
  { key: "outcomes", label: "Outcomes" },
  { key: "tickets", label: "Tickets" },
  { key: "orders", label: "Orders" },
  { key: "check-in", label: "Check-in" },
  { key: "forms", label: "Forms" },
] as const;

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = TABS.some((t) => t.key === tabParam) ? tabParam! : "details";

  const supabase = await createClient();

  const { data: event, error } = await getEventById(supabase, id);
  if (error || !event) notFound();

  const [
    { data: registrations },
    { data: attendance },
    { data: outcomes },
    { data: roles },
    { data: labels },
    { data: users },
    { data: forms },
    { data: ticketTypes },
    { data: promoCodes },
    { data: feeProfilesRaw },
    { data: orders },
    { data: attendanceTickets },
    { data: identities },
  ] = await Promise.all([
    getRegistrationsForEvent(supabase, id),
    getAttendanceForEvent(supabase, id),
    getEventOutcomes(supabase, id),
    getEventRoles(supabase, id),
    getCachedActiveLabels(),
    supabase
      .from("users")
      .select("id, first_name, last_name, email")
      .eq("status", "active")
      .order("first_name"),
    supabase
      .from("forms")
      .select("id, slug, name, is_active, records_attendance, schema, label_id")
      .eq("event_id", id)
      .order("created_at"),
    listTicketTypesByEvent(supabase, id),
    listPromoCodesByEvent(supabase, id),
    getActiveFeeProfiles(supabase),
    listOrdersByEvent(supabase, id),
    listAttendanceTicketsByEvent(supabase, id),
    supabase
      .from("sending_identities")
      .select("id, display_name")
      .eq("is_active", true)
      .order("display_name"),
  ]);

  // Workflows for this event's outcomes (for the Outcomes tab). Returns
  // empty if migration 070 has not been applied yet.
  const outcomeIds = (outcomes ?? []).map((o: { id: string }) => o.id);
  const { data: workflows } = outcomeIds.length
    ? await supabase
        .from("outcome_workflows")
        .select("*, workflow_steps(*)")
        .in("outcome_id", outcomeIds)
    : { data: [] as unknown[] };

  // payment_fee_profiles rows are snake_case in the DB; FeeProfile
  // (pricing.ts) is camelCase. Map once here for the client preview.
  const feeProfiles: FeeProfile[] = (feeProfilesRaw ?? []).map(
    (p: { provider: string; percent_bps: number; fixed_cents: number }) => ({
      provider: p.provider,
      percentBps: p.percent_bps,
      fixedCents: p.fixed_cents,
    })
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/events"
          className="text-xs text-muted-foreground hover:text-foreground uppercase"
          style={{ letterSpacing: "0.15em" }}
        >
          ← Events
        </Link>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="page-eyebrow">EVENTS &amp; GATHERINGS</p>
          <h1 className="page-title">{event.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {event.start_date}
            {event.end_date && event.end_date !== event.start_date
              ? ` – ${event.end_date}`
              : ""}
            {event.location ? ` · ${event.location}` : ""}
          </p>
        </div>
        <EventStatusControl eventId={id} status={event.status} />
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/events/${id}?tab=${t.key}`}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t.key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "details" && (
        <DetailsTab
          event={event}
          eventId={id}
          outcomes={outcomes ?? []}
          roles={roles ?? []}
          labels={labels ?? []}
          users={users ?? []}
          registrations={registrations ?? []}
          attendance={attendance ?? []}
        />
      )}

      {tab === "outcomes" && (
        <OutcomesTab
          eventId={id}
          outcomes={outcomes ?? []}
          labels={labels ?? []}
          forms={forms ?? []}
          identities={identities ?? []}
          workflows={workflows ?? []}
        />
      )}

      {tab === "tickets" && (
        <TicketsTab
          eventId={id}
          ticketingEnabled={event.ticketing_enabled ?? false}
          publicSlug={event.public_slug ?? null}
          xeroItemCode={event.xero_item_code ?? null}
          ticketTypes={ticketTypes ?? []}
          promoCodes={promoCodes ?? []}
          feeProfiles={feeProfiles}
          checkoutQuestions={
            (event.checkout_questions as FormField[] | null) ?? []
          }
        />
      )}

      {tab === "orders" && (
        <OrdersTab eventId={id} orders={orders ?? []} />
      )}

      {tab === "check-in" && (
        <CheckInTab eventId={id} tickets={attendanceTickets ?? []} />
      )}

      {tab === "forms" && <FormsTab eventId={id} forms={forms ?? []} />}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Details & Roles tab
// ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DetailsTab(props: any) {
  const { event, eventId, roles, labels, users, registrations, attendance } = props;

  const regStatusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    pending: "outline",
    confirmed: "default",
    waitlisted: "secondary",
    cancelled: "destructive",
  };

  return (
    <div className="space-y-6">
      <EventDetailsForm
        eventId={eventId}
        status={event.status}
        event={event}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Registrations" value={registrations.length} />
        <StatCard
          label="Attendance"
          value={
            attendance.filter((a: { status: string }) => a.status === "present").length
          }
        />
        <StatCard label="Capacity" value={event.max_capacity ?? "Unlimited"} />
      </div>

      <EventLogo eventId={eventId} logoUrl={event.logo_url} />

      <BaseLabelPicker
        eventId={eventId}
        currentLabelId={event.base_label_id}
        labels={labels}
      />

      <RolesRoster eventId={eventId} roles={roles} users={users} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registrations</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Registered</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {registrations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                    No registrations yet
                  </TableCell>
                </TableRow>
              ) : (
                registrations.map(
                  (reg: {
                    id: string;
                    status: string;
                    registered_at: string;
                    contacts: {
                      first_name: string;
                      last_name: string;
                      preferred_name: string | null;
                      email: string | null;
                    } | null;
                  }) => (
                    <TableRow key={reg.id}>
                      <TableCell className="font-medium">
                        {reg.contacts
                          ? `${reg.contacts.preferred_name ?? reg.contacts.first_name} ${reg.contacts.last_name}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {reg.contacts?.email ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={regStatusColors[reg.status]} className="capitalize">
                          {reg.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(reg.registered_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  )
                )
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────
// Outcomes tab — the module: each outcome + its form + workflows
// ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function OutcomesTab(props: any) {
  const { eventId, outcomes, labels, forms, identities, workflows } = props;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formById = new Map<string, any>(
    (forms ?? []).map((f: { id: string }) => [f.id, f])
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wfByOutcome = new Map<string, any[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const w of (workflows ?? []) as any[]) {
    const arr = wfByOutcome.get(w.outcome_id) ?? [];
    arr.push(w);
    wfByOutcome.set(w.outcome_id, arr);
  }

  const labelOptions = (labels ?? []).map((l: { id: string; name: string }) => ({
    id: l.id,
    name: l.name,
  }));
  const identityOptions = (identities ?? []).map(
    (i: { id: string; display_name: string }) => ({ id: i.id, label: i.display_name })
  );

  return (
    <div className="space-y-6">
      <OutcomesManager eventId={eventId} outcomes={outcomes} labels={labels} />

      <div className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Forms &amp; automation</h2>
          <p className="text-sm text-muted-foreground">
            Each outcome owns one form and the follow-up workflows that run when
            someone responds.
          </p>
        </div>

        {(outcomes ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            Add an outcome above to configure its form and workflows.
          </p>
        ) : (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (outcomes as any[]).map((o) => {
            const form = o.form_id ? formById.get(o.form_id) : null;
            const triggerFields = form?.schema
              ? extractTriggerFields(form.schema as FormSchema)
              : [];
            // A form may be linked to multiple outcomes (migration 072), so
            // offer all of the event's forms.
            const availableForms = (forms ?? []).map(
              (f: { id: string; name: string }) => ({ id: f.id, name: f.name })
            );
            return (
              <Card key={o.id}>
                <CardHeader>
                  <CardTitle className="text-base">{o.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <OutcomeFormLink
                    eventId={eventId}
                    outcomeId={o.id}
                    currentFormId={o.form_id ?? null}
                    currentFormName={form?.name ?? null}
                    forms={availableForms}
                  />
                  <WorkflowsManager
                    eventId={eventId}
                    outcomeId={o.id}
                    outcomeName={o.name}
                    outcomeLabelId={o.label_id ?? null}
                    hasForm={!!form}
                    labelOptions={labelOptions}
                    identityOptions={identityOptions}
                    triggerFields={triggerFields}
                    initialWorkflows={wfByOutcome.get(o.id) ?? []}
                  />
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

function extractTriggerFields(
  schema: FormSchema
): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = [];
  for (const step of schema.steps ?? []) {
    for (const f of step.fields ?? []) {
      if (f.type === "consent") continue;
      out.push({ key: fieldKey(f), label: f.label });
    }
  }
  return out;
}
