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
import { Masthead, SectionBar } from "@/components/ffsa";
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
    <div className="ffsa-screen">
      <Masthead
        context="Venue scheduling"
        title="My requests"
        actions={
          <Link href="/bookings/spaces/new">
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              New booking
            </Button>
          </Link>
        }
      />

      <div className="px-5 py-6 md:px-8 md:py-7">
      {mine.length === 0 ? (
        <div className="border border-ink bg-white">
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center border border-rule-strong bg-bone">
              <Inbox className="h-5 w-5 text-[color:var(--text-tertiary)]" />
            </div>
            <div>
              <p className="text-sm font-medium">No requests yet</p>
              <p className="mt-0.5 text-xs text-[color:var(--text-secondary)]">
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
        <div className="border border-ink bg-white">
          <SectionBar
            title="Submitted by me"
            meta={`${mine.length} booking${mine.length === 1 ? "" : "s"}`}
          />
          <div className="overflow-x-auto">
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
                  <TableCell>
                    <StatusPill status={b.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <ColorDot color={b.venue?.color ?? "#64748b"} />
                      {b.venue?.name ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Link href={`/bookings/spaces/${b.id}`} className="font-medium hover:underline">
                      {b.title}
                    </Link>
                    {b.series_id && <span className="mono-label ml-1.5">weekly</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {dateRangeLabel(b.booking_date, b.end_date)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-[color:var(--text-secondary)]">
                    {timeRangeLabel(b.start_time, b.end_time)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {b.ministry ? (
                      <span className="inline-flex items-center gap-1.5">
                        <ColorDot color={b.ministry.color} />
                        {b.ministry.name}
                      </span>
                    ) : (
                      <span className="text-[color:var(--text-tertiary)]">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
