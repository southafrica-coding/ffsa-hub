import Link from "next/link";
import { Masthead, MastheadAction, NeedsYou, NeedsYouAction, KpiStrip, Kpi, SectionBar, StatusPill } from "@/components/ffsa";
import { daysBetween, dueWords, sastDate } from "@/lib/operations/dates";
import { guideHref } from "@/lib/operations/guide";
import {
  isActiveStage,
  openIn,
  STAGE_LABEL,
  STAGE_TONE,
  teamDates,
  type Stage,
  type Step,
} from "@/lib/operations/visiting-teams";
import { cn } from "@/lib/utils/cn";
import { isVisitingTeamsLead, listOpenSteps, listTeams } from "@/services/visiting-teams";
import { AreaTabs } from "../area-tabs";
import { opsContext } from "../context";
import { AddTeamForm } from "./team-forms";

export const dynamic = "force-dynamic";

type TeamRow = {
  id: string;
  name: string;
  sending_org: string | null;
  stage: Stage;
  dates_text: string | null;
  arrival_on: string | null;
  departure_on: string | null;
  size_text: string | null;
  size_count: number | null;
  locations: string | null;
  host_user_id: string | null;
  host: { display_name: string | null } | null;
};

const ON_THE_WAY: Stage[] = ["enquiry", "confirmed", "preparing", "here"];

export default async function VisitingTeamsPage() {
  const { supabase, user, people } = await opsContext({ teamOnly: true });
  const today = sastDate();

  const [lead, { data: teamRows }, { data: stepRows }] = await Promise.all([
    isVisitingTeamsLead(supabase),
    listTeams(supabase),
    listOpenSteps(supabase),
  ]);
  const teams = (teamRows ?? []) as TeamRow[];
  const steps = (stepRows ?? []) as (Step & { team_id: string })[];
  const stepsBy = new Map<string, Step[]>();
  for (const s of steps) stepsBy.set(s.team_id, [...(stepsBy.get(s.team_id) ?? []), s]);

  const current = teams.filter((t) => ON_THE_WAY.includes(t.stage));
  const past = teams.filter((t) => !ON_THE_WAY.includes(t.stage));
  const here = current.filter((t) => t.stage === "here");
  const soon = current.filter((t) => t.arrival_on && t.stage !== "here" && daysBetween(today, t.arrival_on) >= 0 && daysBetween(today, t.arrival_on) <= 30);
  const late = steps.filter((s) => s.due_on && s.due_on < today && teams.some((t) => t.id === s.team_id && ON_THE_WAY.includes(t.stage)));
  const thisWeek = steps.filter((s) => s.due_on && s.due_on >= today && daysBetween(today, s.due_on) <= 7 && teams.some((t) => t.id === s.team_id && ON_THE_WAY.includes(t.stage)));

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Operations"
        title="Visiting teams"
        actions={
          <>
            <MastheadAction href="/operations/week">This week</MastheadAction>
            <MastheadAction href={guideHref("teams")}>Guide</MastheadAction>
          </>
        }
      />
      <AreaTabs current="teams" />

      {late.length > 0 && (
        <NeedsYou action={<NeedsYouAction href="#teams">See the teams</NeedsYouAction>}>
          {late.length === 1 ? "1 checklist step is past its date" : `${late.length} checklist steps are past their date`}
        </NeedsYou>
      )}

      <KpiStrip>
        <Kpi label="Teams on the way" value={String(current.length)} lead tick={late.length === 0} />
        <Kpi label="Here now" value={String(here.length)} />
        <Kpi label="Arriving in 30 days" value={String(soon.length)} />
        <Kpi label="Steps due this week" value={String(thisWeek.length)} />
      </KpiStrip>

      {lead && (
        <div className="border-b border-rule px-5 py-4 md:px-8">
          <AddTeamForm people={people} me={user.id} />
        </div>
      )}

      <div id="teams">
        <SectionBar title="On the way and here" meta={`${current.length}`} />
        <TeamTable teams={current} stepsBy={stepsBy} today={today} empty={lead ? "No teams yet. Add the first one above." : "No teams given to you yet."} />
      </div>

      {past.length > 0 && (
        <>
          <SectionBar title="Left, postponed, said no, cancelled" meta={`${past.length}`} />
          <TeamTable teams={past} stepsBy={stepsBy} today={today} empty="" />
        </>
      )}
    </div>
  );
}

function TeamTable({ teams, stepsBy, today, empty }: { teams: TeamRow[]; stepsBy: Map<string, Step[]>; today: string; empty: string }) {
  if (teams.length === 0) {
    return <p className="px-5 py-8 text-[14px] text-[color:var(--text-tertiary)] md:px-8">{empty}</p>;
  }
  return (
    <ul className="divide-y divide-rule">
      {teams.map((t) => {
        const open = isActiveStage(t.stage) ? openIn(stepsBy.get(t.id) ?? [], t.stage) : [];
        const next = open[0];
        const late = !!next?.due_on && next.due_on < today;
        return (
          <li key={t.id}>
            <Link
              href={`/operations/visiting-teams/${t.id}`}
              className="grid gap-1.5 px-5 py-3 hover:bg-bone md:grid-cols-[1fr_120px_140px_1fr] md:items-center md:gap-4 md:px-8"
            >
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-ink">{t.name}</div>
                <div className="truncate text-[13px] text-[color:var(--text-tertiary)]">
                  {[teamDates(t), t.size_count ? `${t.size_count} people` : t.size_text, t.locations].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div>
                <StatusPill tone={STAGE_TONE[t.stage]}>{STAGE_LABEL[t.stage]}</StatusPill>
              </div>
              <div className="text-[13px] text-ink">{t.host?.display_name ?? <span className="text-[color:var(--text-tertiary)]">No host yet</span>}</div>
              <div className="min-w-0 text-[13px]">
                {next ? (
                  <span className={cn("block truncate", late ? "font-semibold text-amber" : "text-[color:var(--text-secondary)]")}>
                    {open.length} still needed · {next.label}
                    {next.due_on ? ` (${dueWords(next.due_on, today)})` : ""}
                  </span>
                ) : isActiveStage(t.stage) && t.stage !== "left" ? (
                  <span className="text-[color:var(--text-tertiary)]">Nothing open for {STAGE_LABEL[t.stage].toLowerCase()}</span>
                ) : null}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
