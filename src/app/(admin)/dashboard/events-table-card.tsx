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
    <WidgetShell title="Upcoming events" href="/events" hrefLabel="All events">
      <div className="py-2">
        {events.length === 0 ? (
          <WidgetEmpty>No published events from today on.</WidgetEmpty>
        ) : (
          events.map((event) => (
            <Link
              key={event.id}
              href={`/events/${event.id}`}
              className="flex items-center justify-between gap-4 px-6 py-3 transition-colors duration-150 hover:bg-[color:var(--surface-2)]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[color:var(--text-primary)]">
                  {event.title}
                </p>
                <p className="mt-1 truncate text-[13px] text-[color:var(--text-tertiary)]">
                  {event.location ?? "—"}
                </p>
              </div>
              <p className="shrink-0 font-mono text-[10px] font-bold tabular-nums tracking-[0.1em] text-ink">
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
