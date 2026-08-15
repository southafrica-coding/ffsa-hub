import { createClient } from "@/lib/supabase/server";
import { getNotifications } from "@/services/notifications";
import { getPendingApprovalCount } from "@/services/users";
import { Masthead, NeedsYou, NeedsYouAction } from "@/components/ffsa";
import {
  resolveLayout,
  getWidget,
  WIDGET_REGISTRY,
} from "@/lib/dashboard/widget-registry";

import { MyAssignmentsCard } from "./my-assignments-card";
import { StaffWorkloadCard } from "./staff-workload-card";
import { NotificationFeed } from "./notification-feed";
import { UpcomingEventsWidget } from "./upcoming-events-widget";
import { MyBookingsCard } from "./my-bookings-card";
import { StaffInsuranceCard } from "./staff-insurance-card";
import { VehiclesCard } from "./vehicles-card";
import { PrayerWeekCard } from "./prayer-week-card";
import { SchoolsCountsCard } from "./schools-counts-card";
import { SchoolsPipelineCard } from "./schools-pipeline-card";
import { StudentsByTierCard } from "./students-by-tier-card";
import { StudentsByNationalityCard } from "./students-by-nationality-card";
import { StudentsByGenderCard } from "./students-by-gender-card";
import { StatCards } from "./stat-cards";
import { EventsTableCard } from "./events-table-card";
import {
  RecentRegistrationsCard,
  type RegistrationRow,
} from "./recent-registrations-card";
import { DashboardGrid, type GridSlot } from "./dashboard-grid";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  // Which widgets does this user want, in what order, and which are they even
  // allowed to have? Resolved BEFORE any widget data is fetched, so a hidden
  // widget costs nothing.
  const layout = authUser
    ? await resolveLayout(supabase, authUser.id)
    : { entries: [], enabledKeys: [] as string[], isDefault: true };

  const on = (key: string) => layout.enabledKeys.includes(key);

  // The stat cards show a count of recent registrations and the registrations
  // widget shows the rows themselves — one query serves both.
  const needsRegistrations = on("stat-cards") || on("recent-registrations");

  const [
    contactsResult,
    eventsResult,
    usersResult,
    recentRegistrations,
    upcomingEvents,
    notifications,
    pendingApprovals,
  ] = await Promise.all([
    on("stat-cards")
      ? supabase.from("contacts").select("*", { count: "exact", head: true }).eq("status", "active")
      : null,
    on("stat-cards")
      ? supabase.from("events").select("*", { count: "exact", head: true }).eq("status", "published")
      : null,
    on("stat-cards")
      ? supabase.from("users").select("*", { count: "exact", head: true }).eq("is_active", true)
      : null,
    needsRegistrations
      ? supabase
          .from("event_registrations")
          .select(
            "id, status, registered_at, contacts!contact_id(first_name, last_name, preferred_name), events!event_id(title)"
          )
          .order("registered_at", { ascending: false })
          .limit(10)
      : null,
    on("events-table")
      ? supabase
          .from("events")
          .select("id, title, start_date, location, status")
          .eq("status", "published")
          .gte("start_date", new Date().toISOString().split("T")[0])
          .order("start_date", { ascending: true })
          .limit(5)
      : null,
    authUser && on("notification-feed")
      ? getNotifications(supabase, authUser.id)
      : null,
    // Drives the page's single yellow band. Best-effort: a failure here must
    // never take the dashboard down, it just means no band.
    getPendingApprovalCount(supabase).catch(() => 0),
  ]);

  // Every widget the layout may reference. Client widgets that fetch their own
  // data cost nothing to construct here; the grid only renders the keys in
  // `slots`, and each still self-hides when it has nothing to show.
  const nodes: Record<string, React.ReactNode> = {
    "notification-feed": (
      <NotificationFeed initial={notifications?.notifications ?? []} />
    ),
    "staff-insurance": <StaffInsuranceCard />,
    "upcoming-events": <UpcomingEventsWidget />,
    "my-bookings": <MyBookingsCard />,
    vehicles: <VehiclesCard />,
    "prayer-week": <PrayerWeekCard />,
    "stat-cards": (
      <StatCards
        contacts={contactsResult?.count ?? 0}
        events={eventsResult?.count ?? 0}
        users={usersResult?.count ?? 0}
        recentRegistrations={recentRegistrations?.data?.length ?? 0}
      />
    ),
    "schools-counts": <SchoolsCountsCard />,
    "schools-pipeline": <SchoolsPipelineCard />,
    "students-by-tier": <StudentsByTierCard />,
    "students-by-nationality": <StudentsByNationalityCard />,
    "students-by-gender": <StudentsByGenderCard />,
    "my-assignments": <MyAssignmentsCard />,
    "staff-workload": <StaffWorkloadCard />,
    "events-table": <EventsTableCard events={upcomingEvents?.data ?? []} />,
    "recent-registrations": (
      <RecentRegistrationsCard
        registrations={(recentRegistrations?.data ?? []) as RegistrationRow[]}
      />
    ),
  };

  const slots: GridSlot[] = layout.enabledKeys.map((key) => ({
    key,
    fullWidth: getWidget(key)?.fullWidth ?? true,
  }));

  return (
    <div className="ffsa-screen">
      <Masthead context={weekContext()} title="Dashboard" />

      {/* The page's ONE yellow band. Never add a second. */}
      {pendingApprovals > 0 && (
        <NeedsYou action={<NeedsYouAction href="/users?status=pending_approval">Review</NeedsYouAction>}>
          {pendingApprovals === 1
            ? "1 staff member is waiting on approval"
            : `${pendingApprovals} staff members are waiting on approval`}
        </NeedsYou>
      )}

      <div className="px-5 py-6 md:px-8 md:py-7">
        {slots.length === 0 ? <EmptyDashboard /> : <DashboardGrid slots={slots} nodes={nodes} />}
      </div>
    </div>
  );
}

/** Masthead context line — "WEEK 32 · MON 03 AUG 2026". */
function weekContext() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
  const stamp = now
    .toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })
    .replace(/,/g, "");
  return `Week ${week} · ${stamp}`;
}

// Reachable when someone switches every widget off — without this the page
// renders as a bare heading with no way back to the Customise panel.
function EmptyDashboard() {
  return (
    <DashboardGrid
      slots={[{ key: "empty", fullWidth: true }]}
      nodes={{
        empty: (
          <div className="border border-dashed border-rule-strong bg-surface-1 px-6 py-12 text-center">
            <p className="text-[13px] text-[color:var(--text-secondary)]">
              {WIDGET_REGISTRY.length > 0
                ? "Your dashboard is empty."
                : "No widgets are available for your account."}
            </p>
            <p className="mono-label mt-2">Use Customise above to choose what appears here.</p>
          </div>
        ),
      }}
    />
  );
}
