// The spaces day view, frame 3c: every venue a lane, the day running across,
// and the requests waiting on approval underneath it.
//
// Presentational — it is handed the day's bookings and the venues to draw, and
// turns them into lanes. It reads nothing and decides no permission; the page
// above it does both.

import {
  blockWindow,
  computeHourRange,
} from "@/lib/bookings/timegrid";
import { dateRangeLabel, timeRangeLabel } from "@/lib/bookings/dates";
import type { BookingWithRefs, Venue } from "@/services/bookings";
import { DayTimeline, type TimelineItem, type TimelineResource } from "./day-timeline";
import { ApprovalQueue, type ApprovalRow } from "./approval-queue";

// Only live bookings occupy a venue — denied and cancelled ones never clash.
const LIVE_STATUSES = new Set(["pending", "approved"]);

const FALLBACK_COLOR = "#64748b";

/**
 * No clock window ⇒ the timeline draws a full-width lane block instead of a
 * zero-width sliver. Two cases: a booking with no times at all (the form's
 * "all day"), and a multi-day booking merely passing through this date.
 * Date-only strings are compared as strings, never parsed into a Date, so
 * nothing can shift a day.
 */
function windowFor(b: BookingWithRefs) {
  const multiDay = !!b.end_date && b.end_date > b.booking_date;
  return multiDay ? null : blockWindow(b);
}

export function DayBoard({
  bookings,
  venues,
  date,
  today,
  canApprove,
}: {
  /** The day's bookings, already narrowed to this date by the page. */
  bookings: BookingWithRefs[];
  /** The venues to draw as lanes, already filtered to active + any venue
   *  filter the user picked. */
  venues: Venue[];
  date: string;
  today: string;
  canApprove: boolean;
}) {
  const live = bookings.filter((b) => LIVE_STATUSES.has(b.status));

  // Every venue gets a lane, booked or not: on a screen whose job is "can I
  // have this room at 3", a free room has to be visible.
  const rows = new Map<string, TimelineResource & { sort: number }>();
  const put = (
    id: string,
    name: string,
    building: string | null,
    color: string,
    sort: number
  ) => {
    const key = `venue:${id}`;
    if (!rows.has(key)) {
      rows.set(key, {
        key,
        name,
        meta: building,
        color: color || FALLBACK_COLOR,
        items: [],
        sort,
      });
    }
    return rows.get(key)!;
  };

  for (const v of venues) put(v.id, v.name, v.building, v.color, v.sort_order ?? 9999);

  for (const b of live) {
    // A venue that has been deactivated but still has a live booking keeps its
    // lane, so nothing silently drops off the grid.
    const row = put(
      b.venue_id,
      b.venue?.name ?? "Unnamed space",
      b.venue?.building ?? null,
      b.venue?.color ?? FALLBACK_COLOR,
      b.venue?.sort_order ?? 9999
    );
    const window = windowFor(b);
    const item: TimelineItem = {
      id: b.id,
      title: b.title,
      href: `/bookings/spaces/${b.id}`,
      status: b.status,
      timeLabel: window ? timeRangeLabel(b.start_time, b.end_time) : "All day",
      window,
    };
    row.items.push(item);
  }

  const resources = [...rows.values()].sort(
    (a, b) => a.sort - b.sort || a.name.localeCompare(b.name)
  );

  // An all-day lane contributes no window and so never stretches the day open.
  const { startHour, endHour } = computeHourRange(live.map(windowFor), 7, 19);

  const approvals: ApprovalRow[] = canApprove
    ? live
        .filter((b) => b.status === "pending")
        .map((b) => ({
          id: b.id,
          venue: b.venue?.name ?? "Unnamed space",
          when: `${dateRangeLabel(b.booking_date, b.end_date)} · ${timeRangeLabel(
            b.start_time,
            b.end_time
          )}`,
          why: [b.title, b.requester_name].filter(Boolean).join(" — "),
        }))
    : [];

  return (
    <div className="space-y-6">
      <div className="border border-ink bg-white">
        {resources.length > 0 ? (
          <DayTimeline
            resources={resources}
            startHour={startHour}
            endHour={endHour}
            isToday={date === today}
          />
        ) : (
          <p className="px-6 py-10 text-center text-[13px] text-[color:var(--text-secondary)]">
            No spaces to show. Add one under Manage venues.
          </p>
        )}
      </div>

      {/* Only for someone who can approve, so an empty strip always means
          "nothing waiting", never "not allowed". */}
      {canApprove && <ApprovalQueue initial={approvals} />}
    </div>
  );
}
