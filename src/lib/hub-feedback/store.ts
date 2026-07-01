/**
 * Data access for the feedback tables (migration 117).
 *
 * These tables aren't in the generated `Database` types yet, so we use
 * an untyped view of the admin client and cast results to the domain
 * types in ./types. All access is service-role (server-only).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  Classification,
  CollectedInfo,
  HubIssue,
  HubIssueReport,
  IntakeSession,
  IssueStatus,
  MediaRef,
  TranscriptTurn,
} from "./types";

function db(): SupabaseClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createAdminClient() as unknown as SupabaseClient<any, any, any>;
}

// ── Intake sessions ─────────────────────────────────────────

export async function getActiveSession(
  slackUserId: string
): Promise<IntakeSession | null> {
  const { data } = await db()
    .from("hub_intake_sessions")
    .select("*")
    .eq("slack_user_id", slackUserId)
    .eq("status", "active")
    .maybeSingle();
  return (data as IntakeSession | null) ?? null;
}

/** Start a fresh intake session, abandoning any prior active one. */
export async function startSession(args: {
  slackUserId: string;
  dmChannelId: string;
}): Promise<IntakeSession | null> {
  await db()
    .from("hub_intake_sessions")
    .update({ status: "abandoned", updated_at: new Date().toISOString() })
    .eq("slack_user_id", args.slackUserId)
    .eq("status", "active");

  const { data, error } = await db()
    .from("hub_intake_sessions")
    .insert({
      slack_user_id: args.slackUserId,
      dm_channel_id: args.dmChannelId,
      status: "active",
    })
    .select("*")
    .single();

  if (error) {
    console.error("[hub-feedback/store] startSession failed", error);
    return null;
  }
  return data as IntakeSession;
}

export async function updateSession(
  id: string,
  patch: Partial<{
    transcript: TranscriptTurn[];
    collected: CollectedInfo;
    media: MediaRef[];
    status: IntakeSession["status"];
    last_event_id: string | null;
  }>
): Promise<void> {
  const { error } = await db()
    .from("hub_intake_sessions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("[hub-feedback/store] updateSession failed", error);
}

// ── Issues + reports ────────────────────────────────────────

export async function getOpenIssuesByArea(
  area: string | null
): Promise<HubIssue[]> {
  let q = db().from("hub_issues").select("*").eq("status", "open");
  // Area may be null/blank; when present, narrow the shortlist to it.
  if (area) q = q.eq("area", area);
  const { data } = await q.order("created_at", { ascending: false }).limit(40);
  return (data as HubIssue[] | null) ?? [];
}

export async function getIssue(id: string): Promise<HubIssue | null> {
  const { data } = await db()
    .from("hub_issues")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as HubIssue | null) ?? null;
}

export async function createIssue(args: {
  classification: Classification;
  media: MediaRef[];
}): Promise<HubIssue | null> {
  const c = args.classification;
  const { data, error } = await db()
    .from("hub_issues")
    .insert({
      title: c.title,
      summary: c.summary,
      area: c.area,
      type: c.type,
      size: c.size,
      danger_zone: c.danger_zone,
      proposed_lane: c.proposed_lane,
      status: "open",
      reporter_count: 1,
      media: args.media,
      triage: c as unknown as Record<string, unknown>,
    })
    .select("*")
    .single();
  if (error) {
    console.error("[hub-feedback/store] createIssue failed", error);
    return null;
  }
  return data as HubIssue;
}

export async function addReport(args: {
  issueId: string;
  reporterSlackId: string;
  reporterHubUserId: string | null;
  reporterName: string | null;
  reporterEmail: string | null;
  reportText: string;
  transcript: TranscriptTurn[];
  media: MediaRef[];
}): Promise<HubIssueReport | null> {
  const { data, error } = await db()
    .from("hub_issue_reports")
    .insert({
      issue_id: args.issueId,
      reporter_slack_id: args.reporterSlackId,
      reporter_hub_user_id: args.reporterHubUserId,
      reporter_name: args.reporterName,
      reporter_email: args.reporterEmail,
      report_text: args.reportText,
      transcript: args.transcript,
      media: args.media,
    })
    .select("*")
    .single();
  if (error) {
    console.error("[hub-feedback/store] addReport failed", error);
    return null;
  }
  return data as HubIssueReport;
}

/** Bump reporter_count and merge any new media onto the canonical issue. */
export async function registerDuplicateReport(
  issue: HubIssue,
  newMedia: MediaRef[]
): Promise<number> {
  const mergedMedia = [...issue.media, ...newMedia];
  const nextCount = issue.reporter_count + 1;
  const { error } = await db()
    .from("hub_issues")
    .update({
      reporter_count: nextCount,
      media: mergedMedia,
      updated_at: new Date().toISOString(),
    })
    .eq("id", issue.id);
  if (error)
    console.error("[hub-feedback/store] registerDuplicateReport failed", error);
  return nextCount;
}

export async function setTriageTs(issueId: string, ts: string): Promise<void> {
  const { error } = await db()
    .from("hub_issues")
    .update({ triage_channel_ts: ts })
    .eq("id", issueId);
  if (error) console.error("[hub-feedback/store] setTriageTs failed", error);
}

export async function setIssueStatus(
  issueId: string,
  status: IssueStatus,
  resolution?: string
): Promise<void> {
  const { error } = await db()
    .from("hub_issues")
    .update({
      status,
      ...(resolution !== undefined ? { resolution } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", issueId);
  if (error) console.error("[hub-feedback/store] setIssueStatus failed", error);
}

/** Issues created or updated since a cutoff, for the daily digest. */
export async function issuesSince(sinceIso: string): Promise<HubIssue[]> {
  const { data } = await db()
    .from("hub_issues")
    .select("*")
    .gte("updated_at", sinceIso)
    .order("updated_at", { ascending: false })
    .limit(100);
  return (data as HubIssue[] | null) ?? [];
}
