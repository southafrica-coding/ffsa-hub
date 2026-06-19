"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Settings2,
  CalendarDays,
  CalendarRange,
  Clock,
  List as ListIcon,
  ClipboardList,
  Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  monthParam,
  monthLabel,
  shiftMonth,
  shiftDays,
  weekRangeLabel,
  dayHeadingLabel,
  todayISO,
} from "@/lib/bookings/dates";
import { conflictingIds, type BookingWindow } from "@/lib/bookings/conflicts";
import type {
  BookingAccess,
  BookingWithRefs,
  Venue,
  Ministry,
} from "@/services/bookings";
import { BookingCalendar } from "./booking-calendar";
import { BookingList } from "./booking-list";
import { WeekView } from "./week-view";
import { DayView } from "./day-view";

type ViewKind = "month" | "week" | "day" | "list";
type Filters = { venue: string; ministry: string };

const VIEW_OPTIONS: { key: ViewKind; label: string; icon: typeof CalendarDays }[] = [
  { key: "month", label: "Month", icon: CalendarDays },
  { key: "week", label: "Week", icon: CalendarRange },
  { key: "day", label: "Day", icon: Clock },
  { key: "list", label: "List", icon: ListIcon },
];

export function BookingsView({
  bookings,
  venues,
  ministries,
  access,
  view,
  date,
  year,
  month,
  pendingCount,
  filters,
}: {
  bookings: BookingWithRefs[];
  venues: Venue[];
  ministries: Ministry[];
  access: BookingAccess;
  view: ViewKind;
  date: string;
  year: number;
  month: number;
  pendingCount: number;
  filters: Filters;
}) {
  const router = useRouter();
  const today = todayISO();

  function buildHref(overrides: Partial<Filters & { view: ViewKind; date: string }>) {
    const next = { view, date, ...filters, ...overrides };
    const sp = new URLSearchParams();
    if (next.view && next.view !== "month") sp.set("view", next.view);
    if (next.date && next.date !== today) sp.set("date", next.date);
    if (next.venue !== "all") sp.set("venue", next.venue);
    if (next.ministry !== "all") sp.set("ministry", next.ministry);
    const qs = sp.toString();
    return `/bookings${qs ? `?${qs}` : ""}`;
  }

  function go(overrides: Partial<Filters & { view: ViewKind; date: string }>) {
    router.push(buildHref(overrides));
  }

  let prevDate: string;
  let nextDate: string;
  let headerLabel: string;
  let unit: string;
  if (view === "week") {
    prevDate = shiftDays(date, -7);
    nextDate = shiftDays(date, 7);
    headerLabel = weekRangeLabel(date);
    unit = "week";
  } else if (view === "day") {
    prevDate = shiftDays(date, -1);
    nextDate = shiftDays(date, 1);
    headerLabel = dayHeadingLabel(date);
    unit = "day";
  } else {
    const pm = shiftMonth(year, month, -1);
    const nm = shiftMonth(year, month, 1);
    prevDate = `${monthParam(pm.year, pm.month)}-01`;
    nextDate = `${monthParam(nm.year, nm.month)}-01`;
    headerLabel = monthLabel(year, month);
    unit = "month";
  }

  const clashIds = conflictingIds(bookings as unknown as BookingWindow[]);

  const columnVenues = venues.filter(
    (v) => v.is_active && (filters.venue === "all" || v.id === filters.venue)
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="page-eyebrow">VENUE SCHEDULING</p>
          <h1 className="page-title">Space Bookings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {bookings.length} confirmed booking{bookings.length === 1 ? "" : "s"} in view
            {clashIds.size > 0 && (
              <span className="text-[hsl(0_70%_64%)]">
                {" "}· {clashIds.size} clash{clashIds.size === 1 ? "" : "es"}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/bookings/my-requests">
            <Button variant="ghost" size="sm" className="gap-1.5">
              <Inbox className="h-4 w-4" />
              My requests
            </Button>
          </Link>
          {access.canApprove && (
            <Link href="/bookings/requests">
              <Button variant="outline" size="sm" className="gap-1.5">
                <ClipboardList className="h-4 w-4" />
                Requests
                {pendingCount > 0 && (
                  <span className="ml-0.5 rounded-full bg-primary px-1.5 py-px text-[10px] font-bold text-primary-foreground">
                    {pendingCount}
                  </span>
                )}
              </Button>
            </Link>
          )}
          {access.canManage && (
            <Link href="/bookings/venues">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Settings2 className="h-4 w-4" />
                Manage venues
              </Button>
            </Link>
          )}
          {(access.canRequest || access.canApprove || access.canManage) && (
            <Link href="/bookings/new">
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                New booking
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Manager nudge */}
      {access.canApprove && pendingCount > 0 && (
        <Link
          href="/bookings/requests"
          className="flex items-center justify-between gap-3 rounded-xl border border-primary/35 bg-primary/[0.07] px-4 py-3 transition-colors hover:bg-primary/10"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-primary">
            <ClipboardList className="h-4 w-4" />
            {pendingCount} request{pendingCount === 1 ? "" : "s"} awaiting your review
          </span>
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            Review →
          </span>
        </Link>
      )}

      {/* Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => go({ date: prevDate })}
            aria-label={`Previous ${unit}`}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[11rem] text-center text-base font-semibold tracking-wide">
            {headerLabel}
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => go({ date: nextDate })}
            aria-label={`Next ${unit}`}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="ml-1" onClick={() => go({ date: today })}>
            Today
          </Button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select value={filters.venue} onValueChange={(v) => go({ venue: v })}>
            <SelectTrigger className="h-8 w-[9.5rem] text-xs">
              <SelectValue placeholder="Venue" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All venues</SelectItem>
              {venues.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.ministry} onValueChange={(v) => go({ ministry: v })}>
            <SelectTrigger className="h-8 w-[9.5rem] text-xs">
              <SelectValue placeholder="Ministry" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ministries</SelectItem>
              {ministries.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center rounded-lg border bg-card p-0.5">
            {VIEW_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              return (
                <Button
                  key={opt.key}
                  variant={view === opt.key ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 gap-1 px-2"
                  onClick={() => go({ view: opt.key })}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden md:inline">{opt.label}</span>
                </Button>
              );
            })}
          </div>
        </div>
      </div>

      {view === "list" ? (
        <BookingList
          bookings={bookings}
          clashIds={clashIds}
          canCreate={access.canRequest || access.canApprove || access.canManage}
        />
      ) : view === "week" ? (
        <WeekView bookings={bookings} venues={venues} date={date} clashIds={clashIds} />
      ) : view === "day" ? (
        <DayView bookings={bookings} venues={columnVenues} date={date} clashIds={clashIds} />
      ) : (
        <BookingCalendar
          bookings={bookings}
          venues={venues}
          clashIds={clashIds}
          year={year}
          month={month}
        />
      )}
    </div>
  );
}
