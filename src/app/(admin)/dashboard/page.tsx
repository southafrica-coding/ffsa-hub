import { createClient } from "@/lib/supabase/server";
import { getNotifications } from "@/services/notifications";
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
import { ArrivalInsuranceCard } from "./arrival-insurance-card";
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
    "arrival-insurance": <ArrivalInsuranceCard />,
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
    <div className="space-y-8 animate-fade-up">
      {/* Page header */}
      <div>
        <p
          style={{
            fontSize: "9px",
            letterSpacing: "0.3em",
            fontWeight: 700,
            color: "hsl(42 95% 55%)",
            textTransform: "uppercase",
            marginBottom: "4px",
          }}
        >
          Operations Overview
        </p>
        <h1
          style={{
            fontFamily: "var(--font-bebas, 'Arial Black', sans-serif)",
            fontSize: "clamp(2.5rem, 5vw, 3.75rem)",
            letterSpacing: "0.04em",
            lineHeight: 1,
            color: "#F0EBE3",
          }}
        >
          Dashboard
        </h1>
      </div>

      {slots.length === 0 ? <EmptyDashboard /> : <DashboardGrid slots={slots} nodes={nodes} />}
    </div>
  );
}

// Reachable when someone switches every widget off — without this the page
// renders as a bare heading with no way back to the Customise panel.
function EmptyDashboard() {
  return (
    <DashboardGrid
      slots={[{ key: "empty", fullWidth: true }]}
      nodes={{
        empty: (
          <div
            style={{
              background: "hsl(22 10% 8%)",
              border: "1px dashed hsl(22 8% 18%)",
              borderRadius: "14px",
              padding: "3rem 1.5rem",
              textAlign: "center",
            }}
          >
            <p style={{ fontSize: "13px", color: "hsl(30 8% 50%)" }}>
              {WIDGET_REGISTRY.length > 0
                ? "Your dashboard is empty."
                : "No widgets are available for your account."}
            </p>
            <p style={{ fontSize: "11px", color: "hsl(30 8% 38%)", marginTop: "6px" }}>
              Use Customise above to choose what appears here.
            </p>
          </div>
        ),
      }}
    />
  );
}
