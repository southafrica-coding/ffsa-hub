import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { getMyRequests, type BookingWithRefs } from "@/services/bookings";
import { Plus, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusPill, ColorDot } from "../ui";
import { statusColor } from "@/lib/bookings/status";
import { dateRangeLabel, timeRangeLabel } from "@/lib/bookings/dates";

export default async function MyRequestsPage() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) redirect("/login");

  await requireModuleAccess(supabase, user.id, "bookings");
  const { data } = await getMyRequests(supabase, user.id);
  const mine = (data ?? []) as BookingWithRefs[];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="page-eyebrow">VENUE SCHEDULING</p>
          <h1 className="page-title">My requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mine.length} booking{mine.length === 1 ? "" : "s"} you&apos;ve submitted
          </p>
        </div>
        <Link href="/bookings/spaces/new">
          <Button size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            New booking
          </Button>
        </Link>
      </div>

      {mine.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(22_8%_12%)]">
              <Inbox className="h-5 w-5 text-[hsl(30_6%_42%)]" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No requests yet</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Bookings you submit will show here with their status.
              </p>
            </div>
            <Link href="/bookings/spaces/new">
              <Button size="sm" className="mt-1 gap-1">
                <Plus className="h-4 w-4" />
                New booking
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border bg-card overflow-x-auto shadow-[0_2px_16px_rgba(0,0,0,0.35)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Venue</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Date(s)</TableHead>
                <TableHead>Event time</TableHead>
                <TableHead>Ministry</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mine.map((b) => (
                <TableRow key={b.id}>
                  <TableCell style={{ boxShadow: `inset 3px 0 0 ${statusColor(b.status)}` }}>
                    <StatusPill status={b.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 text-foreground">
                      <ColorDot color={b.venue?.color ?? "#64748b"} />
                      {b.venue?.name ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/bookings/spaces/${b.id}`}
                      className="font-medium text-foreground hover:text-[hsl(42_95%_62%)]"
                    >
                      {b.title}
                    </Link>
                    {b.series_id && (
                      <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-[hsl(42_90%_58%)]">
                        weekly
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {dateRangeLabel(b.booking_date, b.end_date)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {timeRangeLabel(b.start_time, b.end_time)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {b.ministry ? (
                      <span className="inline-flex items-center gap-1.5">
                        <ColorDot color={b.ministry.color} />
                        {b.ministry.name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
