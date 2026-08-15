import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getEvents,
  isClosedEventStatus,
  OPEN_EVENT_STATUSES,
} from "@/services/events";
import type { Tables } from "@/types/database";
type Event = Tables<"events">;
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Masthead, NeedsYou, Chip, StatusPill, DateBlock } from "@/components/ffsa";

const VIEWS = [
  ["active", "Active"],
  ["draft", "Draft"],
  ["published", "Published"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
  ["all", "All"],
] as const;

// Mirrors BRAND_OPTIONS in [id]/event-details-form.tsx. Anything unmapped is
// a plain F&F event, which is also what the email templates fall back to.
const BRAND_LABELS: Record<string, string> = {
  the_send: "The Send",
  ffsa_camps: "FFSA Camps",
  preachers: "Preachers SA",
  wild_ones: "Wild Ones",
  missio: "Missio",
};

const STATUS_TONE: Record<string, "good" | "warn" | "quiet" | "bad"> = {
  published: "good",
  draft: "warn",
  completed: "quiet",
  cancelled: "bad",
};

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  // Middleware already validated; read session from cookie.
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) redirect("/login");

  // "active" is the landing view: events still in play. Closed-out ones
  // (completed/cancelled) stay one click away rather than cluttering it.
  const view = params.status ?? "active";
  const filter =
    view === "active"
      ? { statuses: OPEN_EVENT_STATUSES }
      : view === "all"
        ? {}
        : { status: view };

  // Permission check + data fetch don't depend on each other — run together.
  const [, eventsResult] = await Promise.all([
    requireModuleAccess(supabase, user.id, "events"),
    getEvents(supabase, filter),
  ]);
  const { data: events, count } = eventsResult;
  const rows = (events ?? []) as Event[];

  // Events whose last day has passed but that nobody has closed out yet.
  // Derived from the rows already on screen — no extra query. Only shown on
  // the landing view, so the band can never contradict a chosen filter.
  const today = new Date().toISOString().split("T")[0];
  const stillOpen =
    view === "active"
      ? rows.filter(
          (e) => !isClosedEventStatus(e.status) && (e.end_date ?? e.start_date) < today
        ).length
      : 0;

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`Operations · ${count ?? 0} ${view === "active" ? "active " : ""}${count === 1 ? "event" : "events"}`}
        title="Events"
        actions={
          <Link
            href="/events/new"
            className="border border-ink bg-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white hover:bg-[#262622] hover:text-white"
          >
            + Create event
          </Link>
        }
      />

      {/* The page's ONE yellow band. Never add a second. */}
      {stillOpen > 0 && (
        <NeedsYou>
          {stillOpen === 1
            ? "1 event has finished but is still open — close it out"
            : `${stillOpen} events have finished but are still open — close them out`}
        </NeedsYou>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-b border-rule bg-bone px-8 py-3">
        {VIEWS.map(([key, label]) => (
          <Link key={key} href={`/events${key === "active" ? "" : `?status=${key}`}`}>
            <Chip active={view === key}>{label}</Chip>
          </Link>
        ))}
      </div>

      <div className="px-8 py-7">
        <div className="border border-ink">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Date</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Visibility</TableHead>
                <TableHead>State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center">
                    <p className="mono-label">
                      {view === "active"
                        ? "No active events — closed-out ones are under Completed and Cancelled"
                        : "No events found"}
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((event) => {
                  const start = parseDay(event.start_date);
                  const multiDay =
                    !!event.end_date && event.end_date !== event.start_date;
                  return (
                    <TableRow
                      key={event.id}
                      className={isClosedEventStatus(event.status) ? "opacity-60" : undefined}
                    >
                      <TableCell>
                        <DateBlock day={start.day} mon={start.mon} />
                        <div className="mono-label mt-1 w-12 text-center">{start.year}</div>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/events/${event.id}`}
                          className="font-display text-[19px] font-black uppercase leading-none tracking-[-0.01em] hover:text-electric"
                        >
                          {event.title}
                        </Link>
                        <p className="mt-1 text-[11px] text-[color:var(--text-tertiary)]">
                          {event.location ?? "Location TBC"}
                          {multiDay ? ` · runs to ${formatDay(event.end_date!)}` : ""}
                        </p>
                      </TableCell>
                      <TableCell>
                        <span className="mono-label">
                          {BRAND_LABELS[event.brand] ?? "F&F"}
                        </span>
                      </TableCell>
                      <TableCell>
                        {event.max_capacity ? (
                          <span className="numeral text-[19px]">
                            {groupDigits(event.max_capacity)}
                          </span>
                        ) : (
                          <span className="mono-label">Unlimited</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="mono-label">
                          {event.is_public ? "Public" : "Internal"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={STATUS_TONE[event.status] ?? "quiet"}>
                          {event.status}
                        </StatusPill>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

// start_date/end_date are date-only strings. Appending midnight keeps them off
// the UTC boundary, where a bare `new Date("2026-08-15")` can render the 14th.
function parseDay(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return {
    day: String(d.getDate()).padStart(2, "0"),
    mon: d.toLocaleDateString("en-GB", { month: "short" }).toUpperCase(),
    year: String(d.getFullYear()),
  };
}

function formatDay(iso: string) {
  const { day, mon } = parseDay(iso);
  return `${day} ${mon}`;
}

/** 2000 → "2 000". Thin grouping, per the design's numeral treatment. */
function groupDigits(n: number) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
