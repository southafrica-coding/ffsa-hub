import Link from "next/link";
import { Masthead, MastheadAction, NeedsYou, NeedsYouAction, KpiStrip, Kpi, SectionBar, StatusPill } from "@/components/ffsa";
import { AREAS, STATUS_LABEL, STATUS_TONE, isAreaKey, type OpsItem } from "@/lib/operations/areas";
import { toItem } from "@/lib/operations/change";
import { dayLabel, dueWords, meetingWeek, sastDate, sastMidnight } from "@/lib/operations/dates";
import { isPastDate, isQuiet, needsAttention } from "@/lib/operations/messages";
import { cn } from "@/lib/utils/cn";
import { listClosedSince, listOpenItems } from "@/services/operations";
import { opsContext } from "./context";
import { AddItemForm, ImportButton } from "./ops-forms";

export const dynamic = "force-dynamic";

// What each area will hold once it's built (docs/operations-plan.md).
const COMING: Record<string, string> = {
  transport: "Vehicle inspections, what was found on each vehicle, damage, and what's out of action — read from Fleet.",
  buildings: "Repairs and renovation projects, and who is using which space when.",
  hospitality: "Rooms, who is in them, arrival and departure days, and room inspections.",
  teams: "Every team visiting the base: dates, travel, size, purpose and needs.",
  events: "The operations side of each event: setup, rooms, transport and equipment.",
  equipment: "What's out, what's damaged and what's due back — from the gear register.",
  innovations: "Ideas and requests, and what happened to each one and when.",
};

export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const { area: areaParam } = await searchParams;
  const area = isAreaKey(areaParam) ? areaParam : "maintenance";
  const { supabase, isAdmin, people } = await opsContext({ teamOnly: true });

  const now = new Date();
  const today = sastDate(now);
  const weekStart = sastMidnight(meetingWeek(now).from).toISOString();
  const [{ data: openRows }, { data: doneRows }] = await Promise.all([
    listOpenItems(supabase, { area }),
    listClosedSince(supabase, weekStart, { area }),
  ]);
  const open = ((openRows ?? []) as Parameters<typeof toItem>[0][]).map(toItem);
  const done = ((doneRows ?? []) as Parameters<typeof toItem>[0][]).map(toItem);
  const unseen = open.filter((i) => i.status === "new");
  const attention = open.filter((i) => needsAttention(i, now));
  const live = AREAS.find((a) => a.key === area)!.live || open.length > 0;

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Operations"
        title={AREAS.find((a) => a.key === area)!.label}
        actions={
          <>
            <MastheadAction href="/operations/week">This week</MastheadAction>
            {isAdmin && <MastheadAction href="/operations/settings">Slack settings</MastheadAction>}
          </>
        }
      />

      {/* Area tabs as links, so each area has its own URL. Scrolls sideways
          on its own at 390px; the page never does. */}
      <nav className="flex overflow-x-auto border-b border-ink px-5 pt-4 md:px-8" aria-label="Areas">
        {AREAS.map((a) => (
          <Link
            key={a.key}
            href={`/operations?area=${a.key}`}
            className={cn(
              "flex min-h-11 shrink-0 items-center px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em]",
              a.key === area ? "bg-ink text-white" : "border border-b-0 border-rule text-[color:var(--text-tertiary)] hover:text-ink"
            )}
          >
            {a.label}
          </Link>
        ))}
      </nav>

      {!live ? (
        <div className="px-5 py-12 md:px-8">
          <div className="mono-label mb-3">Coming next</div>
          <p className="max-w-xl text-[15px] leading-relaxed text-[color:var(--text-secondary)]">{COMING[area]}</p>
          <p className="mt-3 max-w-xl text-[13px] text-[color:var(--text-tertiary)]">
            Tasks for this area can already be added from the meeting page.
          </p>
        </div>
      ) : (
        <>
          {unseen.length > 0 && (
            <NeedsYou action={<NeedsYouAction href="#open">Look now</NeedsYouAction>}>
              {unseen.length === 1 ? "1 request nobody has looked at yet" : `${unseen.length} requests nobody has looked at yet`}
            </NeedsYou>
          )}

          <KpiStrip>
            <Kpi label="Open" value={String(open.length)} lead tick={unseen.length === 0} />
            <Kpi label="New" value={String(unseen.length)} />
            <Kpi label="Needs a look" value={String(attention.length)} foot="Due, more time, or quiet a week" />
            <Kpi label="Done this week" value={String(done.length)} foot={`Since ${dayLabel(meetingWeek(now).from)}`} />
          </KpiStrip>

          <div className="flex flex-col gap-3 border-b border-rule px-5 py-4 md:flex-row md:items-start md:justify-between md:px-8">
            <AddItemForm people={people} defaultArea={area} />
            {area === "maintenance" && <ImportButton />}
          </div>

          <div id="open">
            <SectionBar title="Open" meta={`${open.length}`} />
            <ItemTable items={open} today={today} now={now} />
          </div>

          {done.length > 0 && (
            <>
              <SectionBar title="Done this week" meta={`${done.length}`} />
              <ItemTable items={done} today={today} now={now} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function ItemTable({ items, today, now }: { items: OpsItem[]; today: string; now: Date }) {
  if (items.length === 0) {
    return <p className="px-5 py-8 text-[14px] text-[color:var(--text-tertiary)] md:px-8">Nothing here.</p>;
  }
  return (
    <ul className="divide-y divide-rule">
      {items.map((i) => {
        const late = isPastDate(i, today);
        const quiet = isQuiet(i, now);
        return (
          <li key={i.id}>
            <Link href={`/operations/items/${i.id}`} className="grid gap-1.5 px-5 py-3 hover:bg-bone md:grid-cols-[1fr_160px_150px_130px] md:items-center md:gap-4 md:px-8">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-ink">{i.title}</div>
                <div className="truncate text-[13px] text-[color:var(--text-tertiary)]">
                  {[i.location, i.requested_by_name && `asked by ${i.requested_by_name}`, dayLabel(sastDate(i.created_at))].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusPill tone={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</StatusPill>
                {quiet && <StatusPill tone="warn">Quiet</StatusPill>}
              </div>
              <div className="text-[13px] text-ink">{i.owner_name ?? <span className="text-[color:var(--text-tertiary)]">Nobody yet</span>}</div>
              <div className={cn("text-[13px]", late ? "font-semibold text-amber" : "text-[color:var(--text-secondary)]")}>
                {i.due_on && !i.closed_at ? dueWords(i.due_on, today) : ""}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
