import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getOutreachTeamOverview,
  OUTREACH_LEADER_ROLES,
  OUTREACH_ROLE_LABELS,
} from "@/services/outreach-finance";
import { Masthead, SectionBar, StatusPill, type Tone } from "@/components/ffsa";

const TEAM_TONE: Record<string, Tone> = {
  active: "good",
  planning: "warn",
  review: "warn",
  closed: "quiet",
};

/**
 * A team member's view of their outreach: where, when and who's going.
 * No money — the budget belongs to the owner and co-leaders, who are sent
 * on to the full team page in Finance (migration 260).
 */
export default async function MyOutreachTeamPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <p>Not authenticated.</p>;
  }

  const team = await getOutreachTeamOverview(supabase, teamId);

  if (!team) {
    return (
      <div className="ffsa-screen">
        <p className="px-5 py-8 text-sm text-destructive md:px-8">
          Team not found or you don&apos;t have access.
        </p>
      </div>
    );
  }

  // Leaders run the finances on the full page; so do finance staff who
  // aren't on the team.
  if (team.my_role === null || OUTREACH_LEADER_ROLES.includes(team.my_role)) {
    redirect(`/finance/outreach/${teamId}`);
  }

  const dates = [team.start_date, team.end_date]
    .filter(Boolean)
    .map((d) => new Date(d as string).toLocaleDateString())
    .join(" – ");

  return (
    <div className="ffsa-screen">
      <Masthead
        context={[team.program_name, team.location ?? "Location TBC", team.country]
          .filter(Boolean)
          .join(" · ")}
        title={team.team_name}
        actions={
          <StatusPill tone={TEAM_TONE[team.status] ?? "quiet"}>
            {team.status}
          </StatusPill>
        }
      />

      <div className="space-y-6 px-5 py-6 md:px-8 md:py-7">
        <p className="mono-label">
          {dates || "Dates TBC"} · {team.roster.length}{" "}
          {team.roster.length === 1 ? "person" : "people"} · you&apos;re a{" "}
          {(OUTREACH_ROLE_LABELS[team.my_role] ?? team.my_role).toLowerCase()}
        </p>

        <section className="border border-ink">
          <SectionBar title="Who's going" meta={`${team.roster.length}`} />
          <ul>
            {team.roster.map((p) => (
              <li
                key={p.id}
                className="flex min-h-[48px] items-center justify-between gap-4 border-b border-rule px-5 py-3 last:border-b-0 md:px-6"
              >
                <span className="truncate text-[15px] text-ink">{p.name ?? "Unnamed"}</span>
                <span className="mono-label shrink-0">{OUTREACH_ROLE_LABELS[p.role] ?? p.role}</span>
              </li>
            ))}
          </ul>
        </section>

        <p className="text-[13px] text-[color:var(--text-tertiary)]">
          The budget and spending are run by the team&apos;s owner and co-leaders.
        </p>
      </div>
    </div>
  );
}
