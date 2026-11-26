import Link from "next/link";
import { Masthead, MastheadAction, SectionBar, StatusPill } from "@/components/ffsa";
import { STATUS_LABEL, STATUS_TONE, areaLabel, type OpsItem } from "@/lib/operations/areas";
import { dayLabel, dueWords, sastDate } from "@/lib/operations/dates";
import { needsDecision } from "@/lib/operations/messages";
import { loadWeek } from "@/lib/operations/slack";
import { opsContext } from "../context";
import { AddItemForm, AssignRow, RecapButton, type Person } from "../ops-forms";

export const dynamic = "force-dynamic";

// The Wednesday 10:00 operations meeting. The same week the Tuesday 17:00
// Slack summary carried, worked through here: hand things to people with
// a date, add tasks, then post the recap.
export default async function WeekPage() {
  const { supabase, people } = await opsContext({ teamOnly: true });
  const now = new Date();
  const today = sastDate(now);
  const { from, meetingOn, weeks } = await loadWeek(supabase, now);
  const totals = weeks.reduce((t, w) => ({ done: t.done + w.done.length, fresh: t.fresh + w.fresh.length, open: t.open + w.open.length }), { done: 0, fresh: 0, open: 0 });

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`Meeting ${dayLabel(meetingOn)} · 10:00 · week from ${dayLabel(from)}`}
        title="This week"
        actions={<MastheadAction href="/operations">All areas</MastheadAction>}
      />

      <p className="border-b border-rule px-5 py-4 text-[14px] text-[color:var(--text-secondary)] md:px-8">
        <strong className="text-ink">{totals.done} done</strong> · {totals.fresh} new · {totals.open} still open.
        For each thing to talk about, give it to someone with a date — they get a Slack message now and a reminder the day before.
      </p>

      <div className="flex flex-col gap-3 border-b border-rule px-5 py-4 md:flex-row md:items-start md:justify-between md:px-8">
        <AddItemForm people={people} via="meeting" />
        <RecapButton />
      </div>

      {weeks.length === 0 && <p className="px-5 py-10 text-[15px] text-[color:var(--text-secondary)] md:px-8">A quiet week: nothing new, nothing open.</p>}

      {weeks.map((w) => {
        const other = w.open.filter((i) => !w.decide.includes(i));
        return (
          <section key={w.area}>
            <SectionBar title={areaLabel(w.area)} meta={`${w.done.length} done · ${w.fresh.length} new · ${w.open.length} open`} />
            {w.decide.length > 0 && (
              <>
                <div className="mono-label px-5 pt-4 md:px-8">To talk about</div>
                <Rows items={w.decide} today={today} people={people} now={now} />
              </>
            )}
            {other.length > 0 && (
              <details className="border-t border-rule">
                <summary className="flex min-h-11 cursor-pointer items-center px-5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink md:px-8">
                  The other {other.length} open
                </summary>
                <Rows items={other} today={today} people={people} now={now} />
              </details>
            )}
            {w.done.length > 0 && (
              <p className="border-t border-rule px-5 py-3 text-[13px] text-[color:var(--text-secondary)] md:px-8">
                <span className="mono-label mr-2">Done</span>
                {w.done.map((i) => i.title).join(" · ")}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Rows({ items, today, people, now }: { items: OpsItem[]; today: string; people: Person[]; now: Date }) {
  return (
    <ul className="divide-y divide-rule">
      {items.map((i) => (
        <li key={i.id} className="grid gap-3 px-5 py-3 md:grid-cols-[1fr_auto] md:items-center md:px-8">
          <div className="min-w-0">
            <Link href={`/operations/items/${i.id}`} className="text-[15px] font-semibold text-ink underline-offset-2 hover:underline">
              {i.title}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] text-[color:var(--text-tertiary)]">
              <StatusPill tone={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</StatusPill>
              {i.location && <span>{i.location}</span>}
              {i.due_on && <span className={needsDecision(i, now) && i.due_on < today ? "font-semibold text-amber" : undefined}>· {dueWords(i.due_on, today)}</span>}
            </div>
          </div>
          <AssignRow itemId={i.id} ownerUserId={i.owner_user_id} dueOn={i.due_on} people={people} />
        </li>
      ))}
    </ul>
  );
}
