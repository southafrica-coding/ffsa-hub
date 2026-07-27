"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

type AttendanceTicket = {
  id: string;
  status: "valid" | "checked_in";
  code: string;
  checked_in_at: string | null;
  checked_in_by: string | null;
  created_at: string;
  ticket_types: { name: string } | null;
  orders: {
    id: string;
    buyer_first_name: string;
    buyer_last_name: string;
    buyer_email: string;
  } | null;
  users: { first_name: string; last_name: string } | null;
};

export function CheckInTab({
  eventId,
  tickets,
}: {
  eventId: string;
  tickets: AttendanceTicket[];
}) {
  const router = useRouter();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());

  // Auto-refresh every 20s while the tab is in the foreground and
  // staff has it enabled. Pauses when the document is hidden so we
  // don't hammer the DB from background tabs left open all night.
  useEffect(() => {
    if (!autoRefresh) return;
    const tick = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
        setLastRefreshedAt(new Date());
      }
    };
    const interval = setInterval(tick, 20000);
    return () => clearInterval(interval);
  }, [autoRefresh, router]);

  const totalIssued = tickets.length;
  const checkedIn = tickets.filter((t) => t.status === "checked_in").length;
  const outstanding = totalIssued - checkedIn;
  const attendancePct =
    totalIssued === 0 ? 0 : Math.round((checkedIn / totalIssued) * 100);

  const checkedInTickets = tickets
    .filter((t) => t.status === "checked_in" && t.checked_in_at)
    .sort(
      (a, b) =>
        new Date(b.checked_in_at!).getTime() -
        new Date(a.checked_in_at!).getTime()
    );

  return (
    <div className="space-y-6">
      {/* Scanner launcher — prominent so door staff can find it instantly */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Door scanner</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground max-w-md">
              Open the scanner on a phone or tablet at the door. Camera
              scanning works in Chrome on Android and Safari on iOS.
            </p>
            <div className="flex gap-2">
              <Link
                href={`/events/${eventId}/check-in`}
                className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 text-sm font-medium"
              >
                Open scanner
              </Link>
              <Link
                href={`/events/${eventId}/check-in`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground px-4 py-2 text-sm font-medium"
              >
                New window
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Live attendance stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Checked in" value={checkedIn.toString()} />
        <StatCard label="Outstanding" value={outstanding.toString()} />
        <StatCard label="Tickets sold" value={totalIssued.toString()} />
        <StatCard label="Attendance" value={`${attendancePct}%`} />
      </div>

      {/* Roster */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CardTitle className="text-base">Attendance roster</CardTitle>
              <a
                href={`/api/events/${eventId}/attendees/export`}
                className="text-xs text-blue-600 hover:underline"
              >
                Export attendees (CSV)
              </a>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>
                Updated {lastRefreshedAt.toLocaleTimeString()}
              </span>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="h-3 w-3"
                />
                Auto-refresh (20s)
              </label>
              <button
                type="button"
                onClick={() => {
                  router.refresh();
                  setLastRefreshedAt(new Date());
                }}
                className="hover:text-foreground hover:underline"
              >
                Refresh now
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {totalIssued === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No tickets sold yet for this event.
            </p>
          ) : checkedInTickets.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No tickets scanned in yet. The roster will fill as door staff
              check guests in.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Guest</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Checked in</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead className="text-right">Code</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {checkedInTickets.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div className="text-sm">
                        {t.orders
                          ? `${t.orders.buyer_first_name} ${t.orders.buyer_last_name}`
                          : "—"}
                      </div>
                      {t.orders?.buyer_email && (
                        <div className="text-xs text-muted-foreground">
                          {t.orders.buyer_email}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      <Badge variant="secondary" className="capitalize">
                        {t.ticket_types?.name ?? "Ticket"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {t.checked_in_at
                        ? new Date(t.checked_in_at).toLocaleString()
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {t.users
                        ? `${t.users.first_name} ${t.users.last_name}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {t.code}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
