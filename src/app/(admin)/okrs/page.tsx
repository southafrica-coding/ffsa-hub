import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { listMinistries } from "@/services/ministries";
import { getCycleBySlug, getCurrentCycle, listCycles, listObjectives } from "@/services/okrs";
import { summariseByMinistry, totals } from "@/lib/okrs/summary";
import { Masthead, KpiStrip, Kpi, StatusPill } from "@/components/ffsa";
import { statusLabel, statusTone } from "@/lib/okrs/progress";
import type { OkrCycle, OkrObjective } from "@/types/okrs";
import { CycleSwitcher } from "./cycle-switcher";

/**
 * The OKR wall — every ministry's objectives for one cycle.
 *
 * Open to any authenticated user by design: ministry OKRs are meant to be seen
 * across the base. RLS keeps individual OKRs out of this list on its own (the
 * scope filter below is belt-and-braces, and documents the intent).
 */
export default async function OkrsPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { cycle: cycleSlug } = await searchParams;

  const [cyclesRes, currentRes] = await Promise.all([
    listCycles(supabase),
    getCurrentCycle(supabase),
  ]);
  const cycles = (cyclesRes.data ?? []) as OkrCycle[];
  const requested = cycleSlug ? (await getCycleBySlug(supabase, cycleSlug)).data : null;
  const cycle = (requested ?? currentRes.data ?? cycles[0] ?? null) as OkrCycle | null;

  if (!cycle) {
    return (
      <div className="ffsa-screen">
        <Masthead context="Strategy" title="OKRs" />
        <div className="px-5 py-6 md:px-8 md:py-7">
          <p className="text-[13px] text-[color:var(--text-secondary)]">
            No OKR cycle has been opened yet.
          </p>
        </div>
      </div>
    );
  }

  const [{ data: objectiveRows }, { data: ministryRows }] = await Promise.all([
    listObjectives(supabase, { cycleId: cycle.id, scope: "ministry" }),
    // Via the service, not supabase.from(...): staff_ministries postdates the
    // last src/types/database.ts regeneration, so the typed client rejects it.
    listMinistries(supabase),
  ]);

  const objectives = (objectiveRows ?? []) as OkrObjective[];
  const ministries = (ministryRows ?? []) as { id: string; name: string; slug: string }[];
  const summaries = summariseByMinistry(objectives, ministries);
  const t = totals(objectives);

  const completePct = t.keyResults > 0 ? (t.byStatus.complete / t.keyResults) * 100 : 0;

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Strategy"
        title="OKRs"
        actions={<CycleSwitcher cycles={cycles} active={cycle.slug} />}
      />

      <KpiStrip>
        <Kpi label="Ministries" value={String(summaries.length)} lead />
        <Kpi label="Objectives" value={String(t.objectives)} />
        <Kpi
          label="Key results"
          value={String(t.keyResults)}
          foot={`${t.byStatus.complete} complete`}
          // A completed/total ratio genuinely exists here, so a bar is honest.
          bar={t.keyResults > 0 ? { pct: completePct } : undefined}
        />
        <Kpi
          label="Stuck"
          value={String(t.byStatus.stuck)}
          valueColor={t.byStatus.stuck > 0 ? "var(--destructive)" : undefined}
          foot={t.byStatus.stuck > 0 ? "needs a conversation" : "nothing flagged"}
        />
      </KpiStrip>

      <div className="px-5 py-6 md:px-8 md:py-7">
        <p className="mb-5 text-[13px] text-[color:var(--text-secondary)]">
          {cycle.name} cycle · {cycle.starts_on} to {cycle.ends_on}. Ministry OKRs are visible to
          everyone; each ministry&rsquo;s leaders keep their own up to date.
        </p>

        {summaries.length === 0 ? (
          <p className="text-[13px] text-[color:var(--text-secondary)]">
            Nothing has been entered for the {cycle.name} cycle yet.
          </p>
        ) : (
          <div className="border-t border-rule">
            {summaries.map((m) => (
              <Link
                key={m.staff_ministry_id}
                href={`/okrs/${m.staff_ministry_id}?cycle=${cycle.slug}`}
                className="block border-b border-rule bg-white px-4 py-4 hover:bg-bone md:px-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-display text-[17px] font-bold text-ink">{m.name}</span>
                  <span className="font-mono text-[10px] tracking-[0.08em] text-[#7C786C]">
                    {m.objectives} objective{m.objectives === 1 ? "" : "s"} ·{" "}
                    {m.keyResults} key result{m.keyResults === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {(Object.keys(m.byStatus) as (keyof typeof m.byStatus)[])
                    .filter((s) => m.byStatus[s] > 0)
                    .map((s) => (
                      <StatusPill key={s} tone={statusTone(s)}>
                        {m.byStatus[s]} {statusLabel(s)}
                      </StatusPill>
                    ))}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
