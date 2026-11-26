// The cross-team headline. When a team's meeting starts, it gets one
// system headline recapping its paired team's latest ended meeting:
// l10_teams.recap_source_team_id, which is data: a team with none gets
// nothing, and no team or department is special-cased here. The text comes from lib/l10/recap, the same
// data as the Slack channel recap.
//
// Called on meeting start, and again whenever a running meeting is loaded
// or advanced, so a meeting started before this shipped still gets it
// before Headlines. Idempotent: one auto headline per meeting. A repeat
// finds it and stops; two racing inserts hit the unique index on
// (source_meeting_id, recap_of_meeting_id) WHERE is_auto, and the loser's
// 23505 counts as "already there".
//
// Written with the service-role client: it reads another team's meeting,
// and users can never create an auto headline through the API (the
// headline parser refuses is_auto).

import { loadMeetingRecap, recapHeadlineBody } from "./recap";
import { isUniqueClash } from "./db-errors";
import { L10_ONE_AUTO_RECAP_INDEX, L10_TABLES } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type AutoHeadlineOutcome =
  | "inserted"
  | "exists"
  | "no-source-team"
  | "no-ended-source-meeting"
  | "meeting-ended"
  | "not-found"
  | "error";

export async function ensureAutoHeadline(
  admin: Client,
  meetingId: string,
  log: (message: string) => void = (m) => console.error(m)
): Promise<{ outcome: AutoHeadlineOutcome; headline_id?: string }> {
  const m = await admin.from(L10_TABLES.meetings).select("id, team_id, started_at, ended_at").eq("id", meetingId).maybeSingle();
  if (m.error) {
    log(`[l10-auto-headline] meeting ${meetingId}: ${m.error.message}`);
    return { outcome: "error" };
  }
  if (!m.data) return { outcome: "not-found" };
  if (m.data.ended_at) return { outcome: "meeting-ended" };
  const teamId = m.data.team_id as string;

  const existing = await admin
    .from(L10_TABLES.headlines)
    .select("id")
    .eq("team_id", teamId)
    .eq("source_meeting_id", meetingId)
    .eq("is_auto", true)
    .limit(1);
  if (existing.error) {
    log(`[l10-auto-headline] meeting ${meetingId}: ${existing.error.message}`);
    return { outcome: "error" };
  }
  if ((existing.data ?? []).length) return { outcome: "exists", headline_id: existing.data[0].id };

  const team = await admin.from(L10_TABLES.teams).select("id, department_id, recap_source_team_id").eq("id", teamId).maybeSingle();
  if (team.error || !team.data) {
    log(`[l10-auto-headline] meeting ${meetingId}: ${team.error?.message ?? "team not found"}`);
    return { outcome: "error" };
  }
  const sourceTeamId = team.data.recap_source_team_id as string | null;
  if (!sourceTeamId || sourceTeamId === teamId) return { outcome: "no-source-team" };
  // The service role can read any team, so keep the pairing inside the
  // team's own department: one department's meetings never show up in another's.
  const sourceTeam = await admin.from(L10_TABLES.teams).select("id, department_id").eq("id", sourceTeamId).maybeSingle();
  if (sourceTeam.error) {
    log(`[l10-auto-headline] meeting ${meetingId}: ${sourceTeam.error.message}`);
    return { outcome: "error" };
  }
  if (!sourceTeam.data || sourceTeam.data.department_id !== team.data.department_id) {
    log(`[l10-auto-headline] meeting ${meetingId}: recap_source_team_id ${sourceTeamId} is not a team of this department, skipped`);
    return { outcome: "no-source-team" };
  }

  // The source team's latest ENDED meeting. A meeting still running is not news yet.
  const source = await admin
    .from(L10_TABLES.meetings)
    .select("id, ended_at")
    .eq("team_id", sourceTeamId)
    .not("ended_at", "is", null)
    .order("ended_at", { ascending: false })
    .limit(1);
  if (source.error) {
    log(`[l10-auto-headline] meeting ${meetingId}: ${source.error.message}`);
    return { outcome: "error" };
  }
  const sourceMeeting = ((source.data ?? []) as { id: string }[])[0];
  if (!sourceMeeting) return { outcome: "no-ended-source-meeting" };

  const recap = await loadMeetingRecap(admin, sourceMeeting.id);
  if (!recap.ok) {
    log(`[l10-auto-headline] meeting ${meetingId}: source ${sourceMeeting.id} ${recap.reason} ${recap.detail ?? ""}`.trim());
    return { outcome: "error" };
  }

  const inserted = await admin
    .from(L10_TABLES.headlines)
    .insert({
      team_id: teamId,
      source_meeting_id: meetingId,
      recap_of_meeting_id: sourceMeeting.id,
      is_auto: true,
      author_id: null,
      body: recapHeadlineBody(recap.recap),
    })
    .select("id")
    .single();
  if (inserted.error) {
    if (isUniqueClash(inserted.error, L10_ONE_AUTO_RECAP_INDEX)) return { outcome: "exists" };
    log(`[l10-auto-headline] meeting ${meetingId}: insert failed (${inserted.error.code ?? ""} ${inserted.error.message})`);
    return { outcome: "error" };
  }
  return { outcome: "inserted", headline_id: inserted.data.id };
}
