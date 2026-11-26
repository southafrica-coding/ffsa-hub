import Link from "next/link";
import { Masthead, MastheadAction, Kpi, KpiStrip, SectionBar, StatusPill } from "@/components/ffsa";
import { STATUS_TONE, type OpsItem } from "@/lib/operations/areas";
import { toItem } from "@/lib/operations/change";
import { dayLabel, sastDate } from "@/lib/operations/dates";
import { MAINT_LABEL, ageDays, isMonth, maintStatus, monthBounds, monthReport, urgencyLabel } from "@/lib/operations/maintenance";
import { listMaintenanceForReport } from "@/services/operations";
import { opsContext } from "../../context";

export const dynamic = "force-dynamic";

// Operations → Maintenance → the month: what came in, what was finished,
// how long it took, and where keeps coming up. For the operations meeting.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const shift = (m: string, n: number) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

export default async function MaintenanceReportPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: param } = await searchParams;
  const thisMonth = sastDate().slice(0, 7);
  const month = isMonth(param) && param <= thisMonth ? param : thisMonth;
  const { supabase } = await opsContext({ teamOnly: true });

  // Everything that came in before the month ended and was still open at
  // its start (or is open now).
  const { start, end } = monthBounds(month);
  const { data } = await listMaintenanceForReport(supabase, start, end);
  const items = ((data ?? []) as Parameters<typeof toItem>[0][]).map(toItem);
  const r = monthReport(items, month);
  const now = new Date();

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Operations · Maintenance"
        title={monthName(month)}
        actions={
          <>
            <MastheadAction href={`/operations/maintenance/report?month=${shift(month, -1)}`}>← {MONTHS[Number(shift(month, -1).slice(5, 7)) - 1]}</MastheadAction>
            {month < thisMonth && (
              <MastheadAction href={`/operations/maintenance/report?month=${shift(month, 1)}`}>{MONTHS[Number(shift(month, 1).slice(5, 7)) - 1]} →</MastheadAction>
            )}
            <MastheadAction href="/operations?area=maintenance">Maintenance</MastheadAction>
          </>
        }
      />

      <KpiStrip>
        <Kpi label="Logged" value={String(r.logged.length)} lead />
        <Kpi label="Finished" value={String(r.finished.length)} foot="Finished this month, whenever it came in" />
        <Kpi label="Days to finish" value={r.avgDaysToFinish === null ? "–" : String(r.avgDaysToFinish)} foot="On average" />
        <Kpi label="Still open" value={String(r.stillOpen.length)} foot={month === thisMonth ? "Right now" : "Today, from any month"} />
      </KpiStrip>

      {r.byUrgency.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-rule px-5 py-3 text-[13px] text-[color:var(--text-secondary)] md:px-8">
          {r.byUrgency.map((u) => (
            <span key={u.key}>
              <span className="font-semibold text-ink">{u.count}</span> {u.label.toLowerCase()}
            </span>
          ))}
        </div>
      )}

      {r.repeatLocations.length > 0 && (
        <>
          <SectionBar title="Places that came up more than once" meta={`${r.repeatLocations.length}`} />
          <ul className="divide-y divide-rule">
            {r.repeatLocations.map((p) => (
              <li key={p.location} className="px-5 py-3 md:px-8">
                <div className="text-[15px] font-semibold text-ink">
                  {p.location} · {p.count} requests
                </div>
                <div className="text-[13px] text-[color:var(--text-tertiary)]">{p.titles.join(" · ")}</div>
              </li>
            ))}
          </ul>
        </>
      )}

      <SectionBar title="Logged this month" meta={`${r.logged.length}`} />
      <Rows items={r.logged} now={now} />

      <SectionBar title="Finished this month" meta={`${r.finished.length}`} />
      <Rows items={r.finished} now={now} finished />

      <SectionBar title="Still open" meta={`${r.stillOpen.length}`} />
      <Rows items={r.stillOpen} now={now} />
    </div>
  );
}

function Rows({ items, now, finished }: { items: OpsItem[]; now: Date; finished?: boolean }) {
  if (items.length === 0) return <p className="px-5 py-6 text-[14px] text-[color:var(--text-tertiary)] md:px-8">None.</p>;
  return (
    <ul className="divide-y divide-rule">
      {items.map((i) => {
        const s = maintStatus(i.status);
        const took = i.closed_at ? Math.max(0, Math.round((new Date(i.closed_at).getTime() - new Date(i.created_at).getTime()) / 86_400_000)) : null;
        return (
          <li key={i.id}>
            <Link href={`/operations/items/${i.id}`} className="grid gap-1 px-5 py-3 hover:bg-bone md:grid-cols-[1fr_130px_170px] md:items-center md:gap-4 md:px-8">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-ink">{i.title}</div>
                <div className="truncate text-[13px] text-[color:var(--text-tertiary)]">
                  {[i.location, urgencyLabel(i.urgency), i.requested_by_name && `asked by ${i.requested_by_name}`].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div>
                <StatusPill tone={STATUS_TONE[i.status]}>{s ? MAINT_LABEL[s] : "Won't do"}</StatusPill>
              </div>
              <div className="text-[13px] text-[color:var(--text-secondary)]">
                {finished && i.closed_at
                  ? `${dayLabel(sastDate(i.closed_at))} · took ${took === 1 ? "1 day" : `${took} days`}`
                  : `In ${dayLabel(sastDate(i.created_at))} · ${ageDays(i.created_at, i.closed_at ? new Date(i.closed_at) : now)} days`}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
