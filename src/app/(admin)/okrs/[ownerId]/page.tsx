import { redirect, notFound } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getMinistry } from "@/services/ministries";
import {
  getCycleBySlug,
  getCurrentCycle,
  getOkrTeam,
  listCycles,
  listObjectives,
} from "@/services/okrs";
import { callerCanEditMinistryOkrs } from "@/lib/auth/check-okr-access";
import { totals } from "@/lib/okrs/summary";
import { Masthead, KpiStrip, Kpi } from "@/components/ffsa";
import type { OkrCycle, OkrObjective } from "@/types/okrs";
import { CycleSwitcher } from "../cycle-switcher";
import { OwnerOkrs } from "./owner-okrs";

/**
 * One group's OKRs. The group is a staff ministry or an OKR-only team — the
 * id in the URL could be either, so both are looked up and whichever answers
 * wins. They render identically; only edit rights differ.
 */
export default async function OwnerOkrsPage({
  params,
  searchParams,
}: {
  params: Promise<{ ownerId: string }>;
  searchParams: Promise<{ cycle?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { ownerId } = await params;
  const { cycle: cycleSlug } = await searchParams;

  const [{ data: ministry }, { data: team }, cyclesRes, currentRes] = await Promise.all([
    getMinistry(supabase, ownerId),
    getOkrTeam(supabase, ownerId),
    listCycles(supabase),
    getCurrentCycle(supabase),
  ]);
  const owner = (ministry ?? team) as { name: string } | null;
  if (!owner) notFound();
  const isTeam = !ministry && !!team;

  const cycles = (cyclesRes.data ?? []) as OkrCycle[];
  const requested = cycleSlug ? (await getCycleBySlug(supabase, cycleSlug)).data : null;
  const cycle = (requested ?? currentRes.data ?? cycles[0] ?? null) as OkrCycle | null;
  if (!cycle) notFound();

  const [{ data: objectiveRows }, canEditOwner] = await Promise.all([
    listObjectives(supabase, {
      cycleId: cycle.id,
      ministryId: isTeam ? undefined : ownerId,
      teamId: isTeam ? ownerId : undefined,
      scope: "ministry",
    }),
    // A team has no roster, so `null` here asks the leadership/admin question.
    callerCanEditMinistryOkrs(supabase, user.id, isTeam ? null : ownerId),
  ]);

  const objectives = (objectiveRows ?? []) as OkrObjective[];
  const t = totals(objectives);

  // Past cycles are a record, not a workspace. Only the current one is
  // editable, so a leader cannot quietly rewrite last year's result.
  const canEdit = canEditOwner && cycle.is_current;

  return (
    <div className="ffsa-screen">
      <Masthead
        context={isTeam ? "Strategy · OKRs · Team" : "Strategy · OKRs"}
        title={owner.name}
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
            All groups
          </Link>{" "}
          · {cycle.name} cycle
          {!cycle.is_current && " · closed, read-only"}
          {cycle.is_current && !canEditOwner && " · you have read access"}
        </p>

        <OwnerOkrs
          objectives={objectives}
          canEdit={canEdit}
          cycleId={cycle.id}
          ministryId={isTeam ? null : ownerId}
          teamId={isTeam ? ownerId : null}
        />
      </div>
    </div>
  );
}
