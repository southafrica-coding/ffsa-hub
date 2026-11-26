import Link from "next/link";
import { notFound } from "next/navigation";
import { Masthead, MastheadAction, SectionBar, StatusPill } from "@/components/ffsa";
import { dueWords, sastDate } from "@/lib/operations/dates";
import {
  ACTIVE_STAGES,
  fieldLabel,
  isActiveStage,
  nextStage,
  STAGE_LABEL,
  STAGE_PERIOD,
  stageDone,
  teamDates,
  type Stage,
  type Step,
} from "@/lib/operations/visiting-teams";
import { cn } from "@/lib/utils/cn";
import { getPrivate, getTeam, isVisitingTeamsLead, listChanges, listSteps } from "@/services/visiting-teams";
import { opsContext } from "../../context";
import { HostControl, PrivateForm, StageControl, StepRow, TeamDetailsForm } from "../team-forms";

export const dynamic = "force-dynamic";

type StepWithBy = Step & { done_by_user: { display_name: string | null } | null };
type Change = { id: number; field: string; old_value: string | null; new_value: string | null; changed_at: string; by: { display_name: string | null } | null };

export default async function VisitingTeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, people } = await opsContext({ teamOnly: true });

  const [{ data: team }, lead, { data: stepRows }, { data: priv }, { data: changeRows }] = await Promise.all([
    getTeam(supabase, id),
    isVisitingTeamsLead(supabase),
    listSteps(supabase, id),
    getPrivate(supabase, id),
    listChanges(supabase, id),
  ]);
  if (!team) notFound();

  const today = sastDate();
  const stage = team.stage as Stage;
  const steps = (stepRows ?? []) as StepWithBy[];
  const changes = (changeRows ?? []) as Change[];
  const suggest = stageDone(steps, stage) ? nextStage(stage) : null;
  const names = new Map(people.map((p) => [p.id, p.name]));
  const shown = (field: string, v: string | null) =>
    v == null || v === "" ? "—" : field === "host_user_id" ? names.get(v) ?? "someone" : field === "stage" ? STAGE_LABEL[v as Stage] ?? v : v;

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`Visiting teams · ${teamDates(team)}`}
        title={team.name}
        actions={<MastheadAction href="/operations/visiting-teams">All teams</MastheadAction>}
      />

      <div className="grid gap-6 border-b border-rule px-5 py-5 md:grid-cols-[1fr_280px] md:px-8">
        <div>
          <div className="mono-label mb-2">
            Stage {isActiveStage(stage) ? `· ${STAGE_PERIOD[stage]}` : ""}
          </div>
          <StageControl teamId={id} stage={stage} suggest={suggest} />
        </div>
        <div>
          <div className="mono-label mb-2">Host</div>
          {lead ? (
            <HostControl teamId={id} hostId={team.host_user_id} people={people} />
          ) : (
            <p className="text-[15px] text-ink">{team.host?.display_name ?? "No host yet"}</p>
          )}
        </div>
      </div>

      {/* The checklist, by stage: the current one open, the rest folded. */}
      <SectionBar title="Checklist" meta={`${steps.filter((s) => !s.done_at).length} open`} />
      {ACTIVE_STAGES.map((s) => {
        const inStage = steps.filter((x) => x.stage === s);
        const open = inStage.filter((x) => !x.done_at).length;
        return (
          <details key={s} open={s === stage} className="border-b border-rule">
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-5 py-2 md:px-8">
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-ink">
                {STAGE_LABEL[s]} <span className="font-normal text-[color:var(--text-tertiary)]">· {STAGE_PERIOD[s]}</span>
              </span>
              <StatusPill tone={open ? (s === stage ? "warn" : "quiet") : "good"}>{open ? `${open} open` : "All done"}</StatusPill>
            </summary>
            <ul className="divide-y divide-rule pb-2">
              {inStage.map((step) => (
                <StepRow
                  key={step.id}
                  teamId={id}
                  step={step}
                  dueText={step.due_on ? dueWords(step.due_on, today) : null}
                  late={!!step.due_on && step.due_on < today}
                  doneBy={step.done_by_user?.display_name ?? null}
                />
              ))}
            </ul>
          </details>
        );
      })}

      <SectionBar title="Details" meta="Everything can change" />
      <div className="px-5 py-5 md:px-8">
        <TeamDetailsForm teamId={id} team={team} />
      </div>

      <SectionBar title="Team members, dietary, medical" meta="Host and lead only" />
      <div className="px-5 py-5 md:px-8">
        <p className="mb-4 max-w-2xl text-[13px] text-[color:var(--text-tertiary)]">
          Only this team&apos;s host and the Visiting teams lead can see this. Pass on only what each person needs:
          dietary needs for the first-day meals and for places that cater.
        </p>
        <PrivateForm teamId={id} values={(priv ?? {}) as Record<string, string | null>} />
      </div>

      <SectionBar title="History" meta={`${changes.length}`} />
      {changes.length === 0 ? (
        <p className="px-5 py-6 text-[14px] text-[color:var(--text-tertiary)] md:px-8">No changes yet.</p>
      ) : (
        <ul className="divide-y divide-rule">
          {changes.map((c) => (
            <li key={c.id} className="grid gap-0.5 px-5 py-2.5 text-[13px] md:grid-cols-[150px_1fr] md:gap-4 md:px-8">
              <span className="text-[color:var(--text-tertiary)]">
                {new Date(c.changed_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="min-w-0 break-words text-ink">
                <span className="font-semibold">{fieldLabel(c.field)}</span>
                {c.field.startsWith("step:") && !c.field.endsWith(":note") ? (
                  <> {c.new_value === "done" ? "ticked" : "unticked"}</>
                ) : (
                  <>: <span className={cn("text-[color:var(--text-tertiary)]")}>{shown(c.field, c.old_value)}</span> → {shown(c.field, c.new_value)}</>
                )}
                {c.by?.display_name ? <span className="text-[color:var(--text-tertiary)]"> · {c.by.display_name}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="px-5 py-6 md:px-8">
        <Link href="/operations/visiting-teams" className="text-[13px] underline underline-offset-2">Back to all teams</Link>
      </div>
    </div>
  );
}
