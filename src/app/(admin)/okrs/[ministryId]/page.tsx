import { redirect, notFound } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getMinistry } from "@/services/ministries";
import { getCycleBySlug, getCurrentCycle, listCycles, listObjectives } from "@/services/okrs";
import { callerCanEditMinistryOkrs } from "@/lib/auth/check-okr-access";
import { totals } from "@/lib/okrs/summary";
import { Masthead, KpiStrip, Kpi } from "@/components/ffsa";
import type { OkrCycle, OkrObjective } from "@/types/okrs";
import { CycleSwitcher } from "../cycle-switcher";
import { MinistryOkrs } from "./ministry-okrs";

export default async function MinistryOkrsPage({
  params,
  searchParams,
}: {
  params: Promise<{ ministryId: string }>;
  searchParams: Promise<{ cycle?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { ministryId } = await params;
  const { cycle: cycleSlug } = await searchParams;

  const [{ data: ministry }, cyclesRes, currentRes] = await Promise.all([
    getMinistry(supabase, ministryId),
    listCycles(supabase),
    getCurrentCycle(supabase),
  ]);
  if (!ministry) notFound();

  const cycles = (cyclesRes.data ?? []) as OkrCycle[];
  const requested = cycleSlug ? (await getCycleBySlug(supabase, cycleSlug)).data : null;
  const cycle = (requested ?? currentRes.data ?? cycles[0] ?? null) as OkrCycle | null;
  if (!cycle) notFound();

  const [{ data: objectiveRows }, canEditMinistry] = await Promise.all([
    listObjectives(supabase, { cycleId: cycle.id, ministryId, scope: "ministry" }),
    callerCanEditMinistryOkrs(supabase, user.id, ministryId),
  ]);

  const objectives = (objectiveRows ?? []) as OkrObjective[];
  const t = totals(objectives);

  // Past cycles are a record, not a workspace. Only the current one is
  // editable, so a leader cannot quietly rewrite last year's result.
  const canEdit = canEditMinistry && cycle.is_current;

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Strategy · OKRs"
        title={(ministry as { name: string }).name}
        actions={<CycleSwitcher cycles={cycles} active={cycle.slug} />}
      />

      <KpiStrip>
        <Kpi label="Objectives" value={String(t.objectives)} lead />
        <Kpi label="Key results" value={String(t.keyResults)} />
        <Kpi label="Complete" value={String(t.byStatus.complete)} />
        <Kpi
          label="Stuck"
          value={String(t.byStatus.stuck)}
          valueColor={t.byStatus.stuck > 0 ? "var(--destructive)" : undefined}
        />
      </KpiStrip>

      <div className="px-5 py-6 md:px-8 md:py-7">
        <p className="mb-5 text-[13px] text-[color:var(--text-secondary)]">
          <Link href={`/okrs?cycle=${cycle.slug}`} className="underline hover:no-underline">
            All ministries
          </Link>{" "}
          · {cycle.name} cycle
          {!cycle.is_current && " · closed, read-only"}
          {cycle.is_current && !canEditMinistry && " · you have read access"}
        </p>

        <MinistryOkrs
          objectives={objectives}
          canEdit={canEdit}
          cycleId={cycle.id}
          ministryId={ministryId}
        />
      </div>
    </div>
  );
}
