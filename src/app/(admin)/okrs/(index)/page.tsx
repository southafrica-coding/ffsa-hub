import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { listMinistries } from "@/services/ministries";
import {
  getCycleBySlug,
  getCurrentCycle,
  listCycles,
  listObjectives,
} from "@/services/okrs";
import { summariseByOwner, toOwners, totals, writesOkrs } from "@/lib/okrs/summary";
import { Masthead, KpiStrip, Kpi, MastheadAction, SectionBar, StatusPill } from "@/components/ffsa";
import { statusLabel, statusTone } from "@/lib/okrs/progress";
import { callerIsAdmin, getLedMinistryIds } from "@/lib/auth/check-ministry-access";
import { callerCanManageCycles, isLeadershipTeam } from "@/lib/auth/check-okr-access";
import {
  MINISTRY_TYPES,
  MINISTRY_TYPE_SECTION_LABELS,
  ministryTypeOf,
} from "@/lib/ministries/ministry-type";
import type { OkrCycle, OkrObjective, OkrOwnerSummary } from "@/types/okrs";
import { CycleSwitcher } from "../cycle-switcher";
import { NewMinistryButton } from "../new-ministry-button";

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

  const [
    { data: objectiveRows },
    { data: ministryRows },
    isAdmin,
    onLeadership,
    ledMinistryIds,
    canManageCycles,
  ] = await Promise.all([
    listObjectives(supabase, { cycleId: cycle.id, scope: "ministry" }),
    // Via the services, not supabase.from(...): staff_ministries and
    // okr_teams both postdate the last src/types/database.ts regeneration,
    // so the typed client rejects them by name.
    listMinistries(supabase),
    callerIsAdmin(supabase, user.id),
    isLeadershipTeam(supabase, user.id),
    getLedMinistryIds(supabase, user.id),
    callerCanManageCycles(supabase, user.id),
  ]);

  const objectives = (objectiveRows ?? []) as OkrObjective[];
  const allMinistries = (ministryRows ?? []) as {
    id: string;
    name: string;
    slug: string;
    is_active: boolean;
    ministry_type: string | null;
  }[];

  // Anything with objectives in this cycle stays on the wall no matter what —
  // otherwise totals() would keep counting its key results while its card
  // vanished, and the KPI strip would quietly exceed the sum of the cards.
  // Past that, a ministry has to be active AND be the kind of ministry that
  // writes OKRs at all (see writesOkrs — "No Ministry" is not).
  const withObjectives = new Set(
    objectives.map((o) => o.staff_ministry_id).filter((id): id is string => !!id)
  );
  const ministries = allMinistries.filter(
    (m) => withObjectives.has(m.id) || (m.is_active && writesOkrs(m))
  );
  const retiredIds = new Set(
    ministries.filter((m) => !m.is_active).map((m) => m.id)
  );

  // Ministries only. OKR-only teams were seeded to hold Google Sheet blocks
  // that had no ministry; the sheet import is gone, and the wall is meant to
  // mirror the Department list, so they do not belong here.
  const owners = toOwners(ministries, []);
  const summaries = summariseByOwner(objectives, owners);
  const started = summaries.filter((s) => s.objectives > 0);
  const notStarted = summaries.filter((s) => s.objectives === 0);
  const t = totals(objectives);

  // The gap list goes to people who can act on it — a ministry's own leaders,
  // leadership team, admins — rather than onto the wall every staff member
  // sees. Blank ministries on a shared screen read as a scoreboard.
  const seesGaps = isAdmin || onLeadership || ledMinistryIds.length > 0;

  // On a closed cycle "not started" is a permanent historical fact, not a
  // to-do, and canEdit is false on every one of those pages anyway.
  const showNotStarted = seesGaps && cycle.is_current && notStarted.length > 0;

  // Split into Main / Part-time sections, the same grouping as the Ministry
  // tab. Each section keeps its own started / not-started split, so the
  // to-do list for leaders still reads per kind of ministry. A section with
  // nothing to show is dropped, and the headings only appear once there is
  // more than one section.
  const typeById = new Map(ministries.map((m) => [m.id, ministryTypeOf(m.ministry_type)]));
  const sections = MINISTRY_TYPES.map((type) => ({
    type,
    label: MINISTRY_TYPE_SECTION_LABELS[type],
    total: summaries.filter((s) => typeById.get(s.id) === type).length,
    started: started.filter((s) => typeById.get(s.id) === type),
    notStarted: showNotStarted ? notStarted.filter((s) => typeById.get(s.id) === type) : [],
  })).filter((s) => s.started.length > 0 || s.notStarted.length > 0);
  const showHeadings = sections.length > 1;

  const completePct = t.keyResults > 0 ? (t.byStatus.complete / t.keyResults) * 100 : 0;

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Strategy"
        title="OKRs"
        actions={
          <>
            <CycleSwitcher cycles={cycles} active={cycle.slug} />
            {canManageCycles && <MastheadAction href="/okrs/cycles">Cycles</MastheadAction>}
            {isAdmin && <NewMinistryButton cycleSlug={cycle.slug} />}
          </>
        }
      />

      <KpiStrip>
        <Kpi
          label="Groups started"
          value={String(started.length)}
          foot={`of ${summaries.length}`}
          lead
        />
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
            No ministries or teams exist yet.
          </p>
        ) : started.length === 0 && !showNotStarted ? (
          <p className="text-[13px] text-[color:var(--text-secondary)]">
            Nothing has been entered for the {cycle.name} cycle yet.
          </p>
        ) : (
          sections.map((section, i) => (
            <div key={section.type} className={i > 0 ? "mt-10" : undefined}>
              {showHeadings && (
                <SectionBar
                  title={section.label}
                  meta={`${section.started.length} of ${section.total} started`}
                />
              )}

              {section.started.length > 0 && (
                <div className="border-t border-rule">
                  {section.started.map((m) => (
                    <OwnerRow
                      key={m.id}
                      owner={m}
                      cycleSlug={cycle.slug}
                      retired={retiredIds.has(m.id)}
                    />
                  ))}
                </div>
              )}

              {section.notStarted.length > 0 &&
                (showHeadings ? (
                  // Under a section heading a second section bar would read as
                  // a sibling section, so the not-started list gets the
                  // quieter sub-heading band the Ministry tab uses.
                  <div className={section.started.length > 0 ? "mt-4" : undefined}>
                    <div className="mono-label border-t border-rule bg-[#F7F5EE] px-4 py-2 md:px-5">
                      Not started yet · {section.notStarted.length}
                    </div>
                    <div className="border-t border-rule">
                      {section.notStarted.map((m) => (
                        <OwnerRow key={m.id} owner={m} cycleSlug={cycle.slug} retired={false} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className={section.started.length > 0 ? "mt-8" : undefined}>
                    <SectionBar title="Not started yet" meta={`${section.notStarted.length}`} />
                    <div className="border-t border-rule">
                      {section.notStarted.map((m) => (
                        <OwnerRow key={m.id} owner={m} cycleSlug={cycle.slug} retired={false} />
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * One group's row on the wall. The started and not-started variants share a
 * shape on purpose so the list keeps one rhythm — the empty one is quieter,
 * but it must still read as clickable, not disabled, since clicking it is how
 * you start writing.
 */
function OwnerRow({
  owner,
  cycleSlug,
  retired,
}: {
  owner: OkrOwnerSummary;
  cycleSlug: string;
  retired: boolean;
}) {
  const empty = owner.objectives === 0;

  return (
    <Link
      href={`/okrs/${owner.id}?cycle=${cycleSlug}`}
      className="block border-b border-rule bg-white px-4 py-4 hover:bg-bone md:px-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Weight and size stay put when empty so row heights do not jitter. */}
        <span
          className={`font-display text-[17px] font-bold ${
            empty ? "text-[color:var(--text-secondary)]" : "text-ink"
          }`}
        >
          {owner.name}
          {retired && (
            <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#7C786C]">
              retired
            </span>
          )}
        </span>
        <span className="font-mono text-[10px] tracking-[0.08em] text-[#7C786C]">
          {empty ? (
            "Start →"
          ) : (
            <>
              {owner.objectives} objective{owner.objectives === 1 ? "" : "s"} ·{" "}
              {owner.keyResults} key result{owner.keyResults === 1 ? "" : "s"}
            </>
          )}
        </span>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {empty ? (
          <StatusPill tone="quiet">No OKRs yet</StatusPill>
        ) : (
          (Object.keys(owner.byStatus) as (keyof typeof owner.byStatus)[])
            .filter((st) => owner.byStatus[st] > 0)
            .map((st) => (
              <StatusPill key={st} tone={statusTone(st)}>
                {owner.byStatus[st]} {statusLabel(st)}
              </StatusPill>
            ))
        )}
      </div>
    </Link>
  );
}
