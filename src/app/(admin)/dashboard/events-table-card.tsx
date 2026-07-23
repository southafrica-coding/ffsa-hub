import Link from "next/link";
import { WidgetShell, WidgetEmpty } from "./widget-shell";

type EventRow = {
  id: string;
  title: string;
  start_date: string;
  location: string | null;
  status: string;
};

// The published-events list that used to be inline in the dashboard page.
// Distinct from the calendar ticker (`upcoming-events-widget.tsx`), which
// reads the Google base calendar rather than the events table.
export function EventsTableCard({ events }: { events: EventRow[] }) {
  return (
    <WidgetShell title="Upcoming Events" href="/events">
      <div style={{ padding: "0.5rem 0" }}>
        {events.length === 0 ? (
          <WidgetEmpty>No upcoming events</WidgetEmpty>
        ) : (
          events.map((event) => (
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
    </WidgetShell>
  );
}
