import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Users, Calendar, UserCheck, ClipboardCheck, ArrowUpRight } from "lucide-react";
import { getNotifications } from "@/services/notifications";
import { MyAssignmentsCard } from "./my-assignments-card";
import { ApplicationCountsCard } from "./application-counts-card";
import { StaffWorkloadCard } from "./staff-workload-card";
import { NotificationFeed } from "./notification-feed";
import { UpcomingEventsWidget } from "./upcoming-events-widget";
import { MyBookingsCard } from "./my-bookings-card";
import { PrayerWeekCard } from "./prayer-week-card";

function StatCard({
  label,
  value,
  icon: Icon,
  accent = false,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  accent?: boolean;
}) {
  return (
    <div
      className="card-hover"
      style={{
        background: accent ? "hsl(42 95% 55% / 0.06)" : "hsl(22 10% 8%)",
        border: accent ? "1px solid hsl(42 95% 55% / 0.25)" : "1px solid hsl(22 8% 14%)",
        borderRadius: "14px",
        padding: "1.5rem",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Glow behind number for accented card */}
      {accent && (
        <div
          style={{
            position: "absolute",
            bottom: "-20px",
            left: "1.5rem",
            width: "60px",
            height: "60px",
            background: "hsl(42 95% 55% / 0.12)",
            borderRadius: "50%",
            filter: "blur(20px)",
            pointerEvents: "none",
          }}
        />
      )}

      <div className="flex items-start justify-between mb-3">
        <p
          style={{
            fontSize: "9px",
            letterSpacing: "0.22em",
            fontWeight: 700,
            color: accent ? "hsl(42 95% 65%)" : "hsl(30 8% 42%)",
            textTransform: "uppercase",
          }}
        >
          {label}
        </p>
        <div
          style={{
            background: accent ? "hsl(42 95% 55% / 0.15)" : "hsl(22 8% 13%)",
            borderRadius: "8px",
            padding: "6px",
            color: accent ? "hsl(42 95% 55%)" : "hsl(30 8% 45%)",
          }}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>

      <p
        style={{
          fontFamily: "var(--font-bebas, 'Arial Black', sans-serif)",
          fontSize: "3.75rem",
          lineHeight: 1,
          letterSpacing: "0.02em",
          color: accent ? "hsl(42 95% 58%)" : "#F0EBE3",
        }}
      >
        {value}
      </p>
    </div>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  // Dashboard notification feed — derived from actionable items across modules.
  const { notifications } = authUser
    ? await getNotifications(supabase, authUser.id)
    : { notifications: [] };

  const [contactsResult, eventsResult, usersResult, recentRegistrations, upcomingEvents] =
    await Promise.all([
      supabase.from("contacts").select("*", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("events").select("*", { count: "exact", head: true }).eq("status", "published"),
      supabase.from("users").select("*", { count: "exact", head: true }).eq("is_active", true),
      supabase
        .from("event_registrations")
        .select("id, status, registered_at, contacts!contact_id(first_name, last_name, preferred_name), events!event_id(title)")
        .order("registered_at", { ascending: false })
        .limit(10),
      supabase
        .from("events")
        .select("id, title, start_date, location, status")
        .eq("status", "published")
        .gte("start_date", new Date().toISOString().split("T")[0])
        .order("start_date", { ascending: true })
        .limit(5),
    ]);

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

      {/* Notification feed — the homescreen for what needs attention */}
      <NotificationFeed initial={notifications} />

      {/* Upcoming events + my space bookings, side by side */}
      <div className="grid gap-4 lg:grid-cols-2">
        <UpcomingEventsWidget />
        <MyBookingsCard />
      </div>

      {/* Prayer Room — this week's schedule, full width */}
      <PrayerWeekCard />

      {/* Stat cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active Contacts" value={contactsResult.count ?? 0} icon={Users} accent />
        <StatCard label="Published Events" value={eventsResult.count ?? 0} icon={Calendar} />
        <StatCard label="Active Users" value={usersResult.count ?? 0} icon={UserCheck} />
        <StatCard label="Recent Reg." value={recentRegistrations.data?.length ?? 0} icon={ClipboardCheck} />
      </div>

      {/* School application counts (only renders for staff with course/program permission) */}
      <ApplicationCountsCard />

      {/* Schools assignments (only renders for staff with assigned students) */}
      <MyAssignmentsCard />

      {/* Staff workload (only renders for admins/managers) */}
      <StaffWorkloadCard />

      {/* Tables */}
      <div className="grid gap-6 lg:grid-cols-2">

        {/* Upcoming Events */}
        <div
          style={{
            background: "hsl(22 10% 8%)",
            border: "1px solid hsl(22 8% 14%)",
            borderRadius: "14px",
            overflow: "hidden",
          }}
        >
          <div
            className="flex items-center justify-between"
            style={{
              padding: "1.25rem 1.5rem",
              borderBottom: "1px solid hsl(22 8% 13%)",
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-bebas, 'Arial Black', sans-serif)",
                fontSize: "1.15rem",
                letterSpacing: "0.07em",
                color: "#F0EBE3",
              }}
            >
              Upcoming Events
            </p>
            <Link
              href="/events"
              style={{
                fontSize: "9px",
                letterSpacing: "0.2em",
                color: "hsl(42 95% 55%)",
                textTransform: "uppercase",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              View all <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>

          <div style={{ padding: "0.5rem 0" }}>
            {!upcomingEvents.data || upcomingEvents.data.length === 0 ? (
              <p
                style={{
                  padding: "2rem 1.5rem",
                  textAlign: "center",
                  fontSize: "12px",
                  color: "hsl(30 8% 35%)",
                  letterSpacing: "0.05em",
                }}
              >
                No upcoming events
              </p>
            ) : (
              (upcomingEvents.data as Array<{ id: string; title: string; start_date: string; location: string | null; status: string }>).map((event) => (
                <Link
                  key={event.id}
                  href={`/events/${event.id}`}
                  className="flex items-center justify-between transition-colors duration-150 hover:bg-[hsl(22_8%_11%)]"
                  style={{ padding: "0.75rem 1.5rem" }}
                >
                  <div>
                    <p style={{ fontSize: "13px", fontWeight: 500, color: "#F0EBE3" }}>
                      {event.title}
                    </p>
                    <p style={{ fontSize: "11px", color: "hsl(30 8% 42%)", marginTop: "2px" }}>
                      {event.location ?? "—"}
                    </p>
                  </div>
                  <p
                    style={{
                      fontSize: "10px",
                      letterSpacing: "0.05em",
                      color: "hsl(42 95% 55%)",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      marginLeft: "1rem",
                    }}
                  >
                    {new Date(event.start_date).toLocaleDateString("en-ZA", {
                      day: "numeric",
                      month: "short",
                    })}
                  </p>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Recent Registrations */}
        <div
          style={{
            background: "hsl(22 10% 8%)",
            border: "1px solid hsl(22 8% 14%)",
            borderRadius: "14px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "1.25rem 1.5rem",
              borderBottom: "1px solid hsl(22 8% 13%)",
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-bebas, 'Arial Black', sans-serif)",
                fontSize: "1.15rem",
                letterSpacing: "0.07em",
                color: "#F0EBE3",
              }}
            >
              Recent Registrations
            </p>
          </div>

          <div style={{ padding: "0.5rem 0" }}>
            {!recentRegistrations.data || recentRegistrations.data.length === 0 ? (
              <p
                style={{
                  padding: "2rem 1.5rem",
                  textAlign: "center",
                  fontSize: "12px",
                  color: "hsl(30 8% 35%)",
                }}
              >
                No recent registrations
              </p>
            ) : (
              recentRegistrations.data.map((reg) => {
                const contact = Array.isArray(reg.contacts) ? reg.contacts[0] : reg.contacts;
                const event = Array.isArray(reg.events) ? reg.events[0] : reg.events;
                return (
                  <div
                    key={reg.id}
                    className="flex items-center justify-between"
                    style={{ padding: "0.75rem 1.5rem", borderBottom: "1px solid hsl(22 8% 11%)" }}
                  >
                    <div>
                      <p style={{ fontSize: "13px", fontWeight: 500, color: "#F0EBE3" }}>
                        {contact
                          ? `${contact.preferred_name ?? contact.first_name} ${contact.last_name}`
                          : "—"}
                      </p>
                      <p style={{ fontSize: "11px", color: "hsl(30 8% 42%)", marginTop: "2px" }}>
                        {event?.title ?? "—"}
                      </p>
                    </div>
                    <span
                      style={{
                        fontSize: "9px",
                        letterSpacing: "0.15em",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        padding: "3px 8px",
                        borderRadius: "4px",
                        background:
                          reg.status === "confirmed"
                            ? "hsl(142 60% 20%)"
                            : reg.status === "pending"
                            ? "hsl(42 80% 18%)"
                            : "hsl(22 8% 15%)",
                        color:
                          reg.status === "confirmed"
                            ? "hsl(142 60% 55%)"
                            : reg.status === "pending"
                            ? "hsl(42 95% 55%)"
                            : "hsl(30 8% 55%)",
                      }}
                    >
                      {reg.status}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
