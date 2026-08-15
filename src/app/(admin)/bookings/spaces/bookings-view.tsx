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
import { Masthead, NeedsYou } from "@/components/ffsa";
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
    return `/bookings/spaces${qs ? `?${qs}` : ""}`;
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
    <div className="ffsa-screen">
      <Masthead
        context="Venue scheduling"
        title="Space Bookings"
        actions={
          <>
            <Link href="/bookings/spaces/my-requests">
              <Button variant="ghost" size="sm" className="gap-1.5">
                <Inbox className="h-4 w-4" />
                My requests
              </Button>
            </Link>
            {access.canApprove && (
              <Link href="/bookings/spaces/requests">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <ClipboardList className="h-4 w-4" />
                  Requests
                  {pendingCount > 0 && (
                    <span className="ml-0.5 border border-ink px-1.5 py-px text-[10px] font-bold">
                      {pendingCount}
                    </span>
                  )}
                </Button>
              </Link>
            )}
            {access.canManage && (
              <Link href="/bookings/spaces/venues">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Settings2 className="h-4 w-4" />
                  Manage venues
                </Button>
              </Link>
            )}
            {(access.canRequest || access.canApprove || access.canManage) && (
              <Link href="/bookings/spaces/new">
                <Button size="sm" className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  New booking
                </Button>
              </Link>
            )}
          </>
        }
      />

      {/* The page's ONE yellow band — driven by the pending count the page
          already fetches. Never add a second. */}
      {access.canApprove && pendingCount > 0 && (
        <NeedsYou
          action={
            <Link
              href="/bookings/spaces/requests"
              className="border border-ink bg-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-yellow"
            >
              Review
            </Link>
          }
        >
          {pendingCount === 1
            ? "1 booking request is waiting on your review"
            : `${pendingCount} booking requests are waiting on your review`}
        </NeedsYou>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-bone px-8 py-3">
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
          <div className="min-w-[11rem] text-center font-display text-[17px] font-black uppercase tracking-[0.04em]">
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
          <span className="mono-label ml-3">
            {bookings.length} confirmed
            {clashIds.size > 0 && (
              <span className="text-destructive">
                {" "}· {clashIds.size} clash{clashIds.size === 1 ? "" : "es"}
              </span>
            )}
          </span>
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

          <div className="flex items-center">
            {VIEW_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => go({ view: opt.key })}
                  className="chip -ml-px bg-white"
                  data-active={view === opt.key ? "true" : undefined}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="px-5 py-6 md:px-8 md:py-7">
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
    </div>
  );
}
