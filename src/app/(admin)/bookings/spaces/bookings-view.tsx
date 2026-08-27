"use client";

import Link from "next/link";
import { useEffect } from "react";
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
import { buildSpacesHref } from "@/lib/bookings/nav";
import type {
  BookingAccess,
  BookingWithRefs,
  Venue,
  Ministry,
} from "@/services/bookings";
import { BookingCalendar } from "./booking-calendar";
import { BookingList } from "./booking-list";
import { WeekView } from "./week-view";
import { DayBoard } from "./day-board";

type ViewKind = "month" | "week" | "day" | "list";
type Filters = { venue: string; ministry: string };

// Day leads: it is the module's own visual and where Spaces lands.
const VIEW_OPTIONS: { key: ViewKind; label: string; icon: typeof CalendarDays }[] = [
  { key: "day", label: "Day", icon: Clock },
  { key: "week", label: "Week", icon: CalendarRange },
  { key: "month", label: "Month", icon: CalendarDays },
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
  dateWasChosen,
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
  /** False when the URL carried no date, i.e. the server picked one. */
  dateWasChosen: boolean;
}) {
  const router = useRouter();
  const today = todayISO();

  // The server rendered whatever "today" means in ITS timezone. On Vercel that
  // is UTC, so a South African viewer between 22:00 and midnight would land on
  // yesterday's schedule without any way to tell. Correct it to the browser's
  // day — but only when the viewer did not name a date themselves, so this can
  // never override a deliberate choice. Replaces rather than pushes, so it
  // leaves no history entry to get stuck on going back.
  useEffect(() => {
    if (dateWasChosen || today === date) return;
    router.replace(buildSpacesHref({ view, date: today, ...filters }));
  }, [dateWasChosen, today, date, view, filters, router]);

  // Lives in @/lib/bookings/nav so it cannot see `today`: an href built in the
  // browser must never be shortened by comparing against a clock the server
  // does not share. See the note there.
  function buildHref(overrides: Partial<Filters & { view: ViewKind; date: string }>) {
    return buildSpacesHref({ view, date, ...filters, ...overrides });
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

  // Making a booking is the write side of the module. Everyone can SEE the
  // schedule; only ministry leaders and the booking admins can add to it, so
  // every create affordance — and "My requests", which can only ever be empty
  // for someone who cannot request — hangs off this.
  const canCreate = access.canRequest || access.canApprove || access.canManage;

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
            {canCreate && (
              <Link href="/bookings/spaces/my-requests">
                <Button variant="ghost" size="sm" className="gap-1.5">
                  <Inbox className="h-4 w-4" />
                  My requests
                </Button>
              </Link>
            )}
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
            {canCreate && (
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
      {access.canApprove && pendingCount > 0 && view !== "day" && (
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
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-bone px-5 py-3 md:px-8">
        {/* Wraps: on a phone the count was pushed off the end of the row. */}
        <div className="flex flex-wrap items-center gap-1">
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
          <span className="mono-label ml-1 md:ml-3">
            {bookings.length} {view === "day" ? "booked" : "confirmed"}
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
          canCreate={canCreate}
        />
      ) : view === "week" ? (
        <WeekView bookings={bookings} venues={venues} date={date} clashIds={clashIds} />
      ) : view === "day" ? (
        <DayBoard
          bookings={bookings}
          venues={columnVenues}
          date={date}
          today={today}
          canApprove={access.canApprove}
          canCreate={canCreate}
        />
      ) : (
        <BookingCalendar
          bookings={bookings}
          venues={venues}
          clashIds={clashIds}
          year={year}
          month={month}
          canCreate={canCreate}
        />
      )}
      </div>
    </div>
  );
}
