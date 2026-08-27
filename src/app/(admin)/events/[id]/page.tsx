import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEventById, getEventAttendanceCounts } from "@/services/events";
import { capacityPct, groupDigits } from "../format";
import { getRegistrationsForEvent } from "@/services/registrations";
import { getAttendanceForEvent } from "@/services/attendance";
import { getEventOutcomes } from "@/services/event-outcomes";
import { getEventRoles } from "@/services/event-roles";
import { getCachedActiveLabels } from "@/lib/cached-reads";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Masthead,
  Chip,
  StatusPill,
  KpiStrip,
  Kpi,
  SectionBar,
} from "@/components/ffsa";
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
import { getEventLabelIds } from "@/services/event-labels";
import { FormsTab } from "./forms-tab";
import { WorkflowsManager } from "./workflows-manager";
import { OutcomeFormLink } from "./outcome-form-link";
import { fieldKey, type FormSchema, type FormField } from "@/lib/forms/schema";
import { EventLogo } from "./event-logo";
import { EventStatusControl } from "./event-status-control";
import { EventDetailsForm } from "./event-details-form";
import { TicketsTab } from "./tickets-tab";
import { OrdersTab } from "./orders-tab";
import { listRefundsForOrders } from "@/services/order-refunds";
import { CheckInTab } from "./check-in-tab";
import { FeedbackTab, type FeedbackFormRow } from "./feedback-tab";
import {
  listFeedbackFormsForEvent,
  countResponsesByForm,
} from "@/services/event-feedback";
import {
  listTicketTypesByEvent,
  listPromoCodesByEvent,
  listOrdersWithTicketAnswersByEvent,
  listAttendanceTicketsByEvent,
  listTicketEmailsForOrders,
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
  { key: "feedback", label: "Feedback" },
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
    attendanceCounts,
    { data: feedbackForms },
    eventLabelIds,
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
    getActiveFeeProfiles(supabase, event.currency),
    listOrdersWithTicketAnswersByEvent(supabase, id),
    listAttendanceTicketsByEvent(supabase, id),
    supabase
      .from("sending_identities")
      .select("id, display_name")
      .eq("is_active", true)
      .order("display_name"),
    // Headcount for the Capacity KPI. The id is already known here, so
    // it rides along with everything else rather than costing a wave.
    getEventAttendanceCounts(supabase, [id]),
    listFeedbackFormsForEvent(supabase, id),
    // Every CRM label this event applies (migration 193). Empty before
    // the migration is applied — the picker then shows base_label_id only.
    getEventLabelIds(supabase, id),
  ]);

  // Primary first, so the picker can mark it as such.
  const baseLabelIds = (
    eventLabelIds.length > 0
      ? eventLabelIds
      : event.base_label_id
        ? [event.base_label_id]
        : []
  ).sort((a: string, b: string) =>
    a === event.base_label_id ? -1 : b === event.base_label_id ? 1 : 0
  );

  // Response tallies for the Feedback tab. They depend on the form ids,
  // so they can't join the Promise.all above.
  const feedbackRows = (feedbackForms ?? []) as FeedbackFormRow[];
  const feedbackCounts = await countResponsesByForm(
    supabase,
    feedbackRows.map((f) => f.id)
  );

  // null when the read was blocked — the KPI then falls back to the
  // bare capacity figure it showed before.
  const coming = attendanceCounts.get(id)?.count ?? null;

  // Refund history for the Orders tab (migration 128). Needs the order
  // ids, so it can't join the Promise.all above. Returns empty if the
  // migration has not been applied yet.
  const { data: orderRefunds } = await listRefundsForOrders(
    supabase,
    (orders ?? []).map((o: { id: string }) => o.id)
  );

  // Ticket-email delivery status for the Orders tab (migration 141).
  // Same order-ids dependency as refunds, so it can't join the Promise.all
  // above. Returns empty if the migration hasn't been applied yet.
  const { data: ticketEmails } = await listTicketEmailsForOrders(
    supabase,
    (orders ?? []).map((o: { id: string }) => o.id)
  );

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

  // Masthead context line — the event's own when/where, in mono caps.
  const contextLine = [
    formatDayRange(event.start_date, event.end_date),
    event.location,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="ffsa-screen">
      <Masthead
        context={contextLine}
        title={event.title}
        actions={
          <EventStatusControl
            eventId={id}
            status={event.status}
            cancellationMessage={event.cancellation_message ?? null}
          />
        }
      />

      {/* Tab navigation — folder tabs on the module rule, not pills. */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-rule bg-bone px-8 py-3">
        {TABS.map((t) => (
          <Link key={t.key} href={`/events/${id}?tab=${t.key}`}>
            <Chip active={tab === t.key}>{t.label}</Chip>
          </Link>
        ))}
      </div>

      <div className="space-y-6 px-8 py-7">
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
            coming={coming}
            baseLabelIds={baseLabelIds}
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
            ticketTypes={ticketTypes ?? []}
            promoCodes={promoCodes ?? []}
            feeProfiles={feeProfiles}
            currency={event.currency}
            // Once real money has moved, the currency is frozen — an
            // order recorded in the old one would misreport.
            currencyLocked={(orders ?? []).some(
              (o: { status: string }) => o.status !== "pending"
            )}
            checkoutQuestions={
              (event.checkout_questions as FormField[] | null) ?? []
            }
            buyerFields={event.buyer_fields ?? []}
          />
        )}

        {tab === "orders" && (
          <OrdersTab
            eventId={id}
            orders={orders ?? []}
            refunds={orderRefunds ?? []}
            ticketEmails={ticketEmails ?? []}
            currency={event.currency}
            eventStatus={event.status}
            hasCancellationMessage={!!event.cancellation_message?.trim()}
          />
        )}

        {tab === "check-in" && (
          <CheckInTab eventId={id} tickets={attendanceTickets ?? []} />
        )}

        {tab === "forms" && <FormsTab eventId={id} forms={forms ?? []} />}

        {tab === "feedback" && (
          <FeedbackTab
            eventId={id}
            forms={feedbackRows}
            responseCounts={feedbackCounts}
          />
        )}
      </div>
    </div>
  );
}

// "12 – 14 SEP 2026", or a single day when there's no distinct end date.
function formatDayRange(start: string, end: string | null) {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`)
      .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
      .replace(/,/g, "");
  return end && end !== start ? `${fmt(start)} – ${fmt(end)}` : fmt(start);
}

// ────────────────────────────────────────────────────────────
// Details & Roles tab
// ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DetailsTab(props: any) {
  const { event, eventId, roles, labels, users, registrations, attendance, coming, baseLabelIds } =
    props;

  // "1 140 / 2 000" won't fit at the strip's 54px, so a ratio drops to
  // the smaller numeral the way the money cells do. The bar only draws
  // when there's a capacity to be a fraction of.
  const cap: number | null = event.max_capacity ?? null;
  const comingCount: number | null = coming ?? null;
  const pct = comingCount === null ? null : capacityPct(comingCount, cap);
  const capacityValue =
    comingCount === null
      ? cap
        ? groupDigits(cap)
        : "∞"
      : cap
        ? `${groupDigits(comingCount)} / ${groupDigits(cap)}`
        : groupDigits(comingCount);

  const regStatusTone: Record<string, "good" | "warn" | "quiet" | "bad"> = {
    pending: "warn",
    confirmed: "good",
    waitlisted: "quiet",
    cancelled: "bad",
  };

  return (
    <div className="space-y-6">
      <EventDetailsForm
        eventId={eventId}
        status={event.status}
        event={event}
      />

      <div className="border-x border-t border-ink">
        <KpiStrip>
          {/* No `lead` cell: the masthead tick is this screen's only yellow. */}
          <Kpi label="Registrations" value={String(registrations.length)} />
          <Kpi
            label="Attendance"
            value={String(
              attendance.filter((a: { status: string }) => a.status === "present").length
            )}
          />
          <Kpi
            label="Capacity"
            value={capacityValue}
            size={cap && comingCount !== null ? 26 : 54}
            foot={cap ? undefined : "Unlimited"}
            bar={pct === null ? undefined : { pct }}
          />
        </KpiStrip>
      </div>

      <EventLogo eventId={eventId} logoUrl={event.logo_url} />

      <BaseLabelPicker
        eventId={eventId}
        currentLabelIds={baseLabelIds}
        labels={labels}
      />

      <RolesRoster eventId={eventId} roles={roles} users={users} />

      <div className="border border-ink">
        <SectionBar
          title="Registrations"
          meta={`${registrations.length} ${registrations.length === 1 ? "person" : "people"}`}
        />
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
                <TableCell colSpan={4} className="py-8 text-center">
                  <span className="mono-label">No registrations yet</span>
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
                      <StatusPill tone={regStatusTone[reg.status] ?? "quiet"}>
                        {reg.status}
                      </StatusPill>
                    </TableCell>
                    <TableCell className="text-[color:var(--text-tertiary)]">
                      {new Date(reg.registered_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                )
              )
            )}
          </TableBody>
        </Table>
      </div>
    </div>
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
