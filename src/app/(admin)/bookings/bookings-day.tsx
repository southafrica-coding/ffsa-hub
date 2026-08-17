// Frame 3c, the screen itself — masthead, control strip, day timeline,
// approvals. Presentational only: it receives resources and requests already
// resolved and already gated, and has no way to read anything for itself.
//
// The split is deliberate. page.tsx owns "who may see which half"; this file
// owns "what the frame looks like". Two halves that were separately fetched and
// separately gated arrive here as one list, so nothing in the layout can leak a
// service the viewer has no access to.

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Masthead } from "@/components/ffsa";
import { humanDate, shiftDays } from "@/lib/bookings/dates";
import { DayTimeline, type TimelineResource } from "./day-timeline";
import { ApprovalQueue, type ApprovalRow } from "./approval-queue";

export type Showing = "all" | "spaces" | "vehicles";

const NAV_BTN =
  "border border-ink bg-bone px-2.5 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] hover:bg-[color:var(--surface-4)]";
const BOOK_BTN =
  "border border-ink bg-ink px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white hover:bg-[#262622] hover:text-white";

const FILTERS: { key: Showing; label: string }[] = [
  { key: "all", label: "All resources" },
  { key: "spaces", label: "Spaces only" },
  { key: "vehicles", label: "Vehicles only" },
];

export function BookingsDay({
  date,
  today,
  showing,
  resources,
  startHour,
  endHour,
  approvals,
  showApprovals,
  canSpaces,
  canVehicles,
  canBookSpace,
  canBookVehicle,
}: {
  date: string;
  today: string;
  showing: Showing;
  resources: TimelineResource[];
  startHour: number;
  endHour: number;
  approvals: ApprovalRow[];
  /** Whether to draw the approvals strip at all — false for a viewer who
   *  approves neither service, so they never see an empty promise. */
  showApprovals: boolean;
  canSpaces: boolean;
  canVehicles: boolean;
  canBookSpace: boolean;
  canBookVehicle: boolean;
}) {
  const eyebrow = [
    humanDate(date).toUpperCase(),
    `${resources.length} ${resources.length === 1 ? "RESOURCE" : "RESOURCES"}`,
    approvals.length > 0 ? `${approvals.length} WAITING` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const href = (o: { date?: string; show?: Showing }) => {
    const next = { date, show: showing, ...o };
    const sp = new URLSearchParams();
    if (next.date !== today) sp.set("date", next.date);
    if (next.show !== "all") sp.set("show", next.show);
    const qs = sp.toString();
    return `/bookings${qs ? `?${qs}` : ""}`;
  };

  // Only worth drawing to someone who has both halves to filter between.
  const showFilter = canSpaces && canVehicles;

  return (
    <div className="ffsa-screen">
      <Masthead
        context={eyebrow}
        title="Bookings"
        actions={
          <>
            <div className="flex items-center">
              <Link
                href={href({ date: shiftDays(date, -1) })}
                className={NAV_BTN}
                aria-label="Previous day"
              >
                ←
              </Link>
              <Link
                href={href({ date: today })}
                className={`${NAV_BTN} -ml-px min-w-[7.5rem] text-center`}
              >
                {humanDate(date)}
              </Link>
              <Link
                href={href({ date: shiftDays(date, 1) })}
                className={`${NAV_BTN} -ml-px`}
                aria-label="Next day"
              >
                →
              </Link>
            </div>
            {canBookSpace && (
              <Link href="/bookings/spaces/new" className={BOOK_BTN}>
                + Book space
              </Link>
            )}
            {canBookVehicle && (
              <Link href="/bookings/vehicles/new" className={BOOK_BTN}>
                + Book vehicle
              </Link>
            )}
          </>
        }
      />

      {/* Control strip. The frame puts SHOWING in the module panel; per-module
          panel content is its own backlog item, so it sits with the other
          controls for now. The two service links live here because the global
          nav carries a single Bookings entry, and those routes still hold the
          month / week / list views, the fleet and the full review queues. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-bone px-5 py-3 md:px-8">
        {showFilter ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono-label mr-1">Showing</span>
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={href({ show: f.key })}
                className="chip bg-white"
                data-active={showing === f.key ? "true" : undefined}
              >
                {f.label}
              </Link>
            ))}
          </div>
        ) : (
          <span className="mono-label">
            {canSpaces ? "Spaces" : "Vehicles"} · one day
          </span>
        )}

        <div className="flex items-center gap-2">
          {canSpaces && (
            <Link href="/bookings/spaces" className="chip bg-white">
              Spaces <ArrowUpRight className="h-3 w-3" />
            </Link>
          )}
          {canVehicles && (
            <Link href="/bookings/vehicles" className="chip bg-white">
              Vehicles <ArrowUpRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>

      <div className="space-y-6 px-5 py-6 md:px-8 md:py-7">
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
              No resources to show for this day.
            </p>
          )}
        </div>

        {showApprovals && <ApprovalQueue initial={approvals} />}
      </div>
    </div>
  );
}
