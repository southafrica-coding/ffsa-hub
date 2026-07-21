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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus } from "lucide-react";

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

  const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    draft: "outline",
    published: "default",
    cancelled: "destructive",
    completed: "secondary",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="page-eyebrow">EVENTS &amp; GATHERINGS</p>
          <h1 className="page-title">Events</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {count ?? 0} {view === "active" ? "active " : ""}
            {count === 1 ? "event" : "events"}
          </p>
        </div>
        <Link href="/events/new">
          <Button size="sm" className="gap-1">
            <Plus className="h-4 w-4" />
            Create Event
          </Button>
        </Link>
      </div>

      <div className="flex gap-1 flex-wrap">
        {(
          [
            ["active", "Active"],
            ["draft", "Draft"],
            ["published", "Published"],
            ["completed", "Completed"],
            ["cancelled", "Cancelled"],
            ["all", "All"],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={`/events${key === "active" ? "" : `?status=${key}`}`}
          >
            <Button variant={view === key ? "default" : "ghost"} size="sm">
              {label}
            </Button>
          </Link>
        ))}
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Public</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!events || events.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-muted-foreground py-8"
                >
                  {view === "active"
                    ? "No active events. Closed-out events are under Completed and Cancelled."
                    : "No events found"}
                </TableCell>
              </TableRow>
            ) : (
              (events as Event[]).map((event) => (
                <TableRow
                  key={event.id}
                  className={isClosedEventStatus(event.status) ? "opacity-60" : undefined}
                >
                  <TableCell>
                    <Link
                      href={`/events/${event.id}`}
                      className="font-medium hover:underline"
                    >
                      {event.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {event.start_date}
                    {event.end_date && event.end_date !== event.start_date
                      ? ` – ${event.end_date}`
                      : ""}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {event.location ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={statusColors[event.status] ?? "outline"}
                      className="capitalize"
                    >
                      {event.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {event.brand === "the_send" ? (
                      <Badge
                        variant="outline"
                        className="border-amber-500/40 text-amber-600 dark:text-amber-400 uppercase tracking-wider text-[10px]"
                      >
                        THE SEND
                      </Badge>
                    ) : event.brand === "ffsa_camps" ? (
                      <Badge
                        variant="outline"
                        className="border-blue-500/40 text-blue-600 dark:text-blue-400 uppercase tracking-wider text-[10px]"
                      >
                        FFSA CAMPS
                      </Badge>
                    ) : event.brand === "preachers" ? (
                      <Badge
                        variant="outline"
                        className="border-slate-400/40 text-slate-600 dark:text-slate-300 uppercase tracking-wider text-[10px]"
                      >
                        PREACHERS
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">F&amp;F</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {event.is_public ? "Yes" : "No"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
