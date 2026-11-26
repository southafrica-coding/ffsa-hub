// Song Library upload DMs. When a song gets its first audio (a new song) or
// a further version, every subscriber gets one Slack DM from the FFSA Hub
// Activity bot, with a "why you got this" line and a button back to the
// song in the Hub. Subscribers are song_library_subscriptions rows:
// all_uploads, plus writer subscriptions to anyone credited on the song.
// One DM per person per upload even when several subscriptions match.
//
// Same delivery as the L10 follow-up (lib/slack/l10-followup, after Fleet):
// conversations.open then chat.postMessage on the "hub" bot, and the same
// gate: only on the Hub's real deployment (VERCEL_ENV production, preview
// writes not disabled). Off, nothing is claimed.
//
// Exactly once per (upload, subscriber). Before a DM goes out the sender
// claims it by inserting its song_library_notifications row (419's outbox),
// whose partial unique index refuses a second claim: whoever's insert lands
// sends; a retried upload, a double submit or two servers DM each person
// once. Slack refusing gives the claim back (the row is deleted while
// sent_at is still null) so a later run can retry; a sent DM stamps
// slack_ts and sent_at. Same residual as the L10 follow-up: a crash between
// claim and send leaves a claim nobody retries (a missed DM, never a double).
//
// 419 keys the new-song claim (kind new_upload, unique per user and song).
// It has no claim for a LATER version: new_upload allows one row per song
// and stage_moved is for stage moves. Version DMs therefore go through the
// SongDmClaims interface, and the 419 store refuses them ("unsupported",
// logged, nothing sent) until Hub Data adds kind 'new_version' keyed on the
// version's stage event (see VERSION_CLAIMS_IN_SCHEMA).
//
// The uploader is never DMed. Someone without a Slack id is skipped and
// logged, without a claim. Uses the service role: it reads other people's
// subscriptions and Slack ids, which RLS rightly keeps private.

import * as slack from "@/lib/slack/client";
import { isBotConfigured } from "@/lib/slack/bots";
import { canSendL10Followup } from "@/lib/slack/l10-followup";
import { SL_TABLES, type Client, type SongNotificationReason } from "@/lib/song-library/types";

/** Flip once 419 (or a follow-up) accepts kind 'new_version' with a unique (user_id, stage_event_id) index. */
export const VERSION_CLAIMS_IN_SCHEMA = false;

/** The same gate as the L10 follow-up DMs. */
export function canSendSongLibraryDm(env: NodeJS.ProcessEnv = process.env): boolean {
  return canSendL10Followup(env);
}

function appBase(env: NodeJS.ProcessEnv): string {
  return (env.NEXT_PUBLIC_APP_URL || env.NEXT_PUBLIC_SITE_URL || "https://www.ffsahub.com").replace(/\/+$/, "");
}

export function songUrl(songId: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${appBase(env)}/song-library/${encodeURIComponent(songId)}`;
}

export function subscriptionsUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${appBase(env)}/song-library/subscriptions`;
}

// ── Claims ─────────────────────────────────────────────────

export type UploadKind = "new_upload" | "new_version";

export type ClaimKey = {
  userId: string;
  songId: string;
  kind: UploadKind;
  /** The version's song_library_stage_events row (kind 'version'). */
  versionEventId: string | null;
  reason: SongNotificationReason;
};

export type ClaimResult = { outcome: "claimed"; id: string } | { outcome: "taken" } | { outcome: "unsupported" } | { outcome: "error"; error: string };

export interface SongDmClaims {
  claim(key: ClaimKey): Promise<ClaimResult>;
  markSent(id: string, slackTs: string | null, at: string): Promise<void>;
  release(id: string): Promise<void>;
}

/** 419's song_library_notifications as the claim store. */
export function notificationClaims(admin: Client, opts: { versionClaims?: boolean } = {}): SongDmClaims {
  const versionClaims = opts.versionClaims ?? VERSION_CLAIMS_IN_SCHEMA;
  return {
    async claim(key) {
      if (key.kind === "new_version" && !versionClaims) return { outcome: "unsupported" };
      const row =
        key.kind === "new_upload"
          ? { user_id: key.userId, song_id: key.songId, kind: "new_upload", reason: key.reason }
          : { user_id: key.userId, song_id: key.songId, kind: "new_version", stage_event_id: key.versionEventId, reason: key.reason };
      const ins = await admin.from(SL_TABLES.notifications).insert(row).select("id").single();
      if (ins.error?.code === "23505") return { outcome: "taken" };
      if (ins.error || !ins.data) return { outcome: "error", error: ins.error?.message ?? "no row" };
      return { outcome: "claimed", id: (ins.data as { id: string }).id };
    },
    async markSent(id, slackTs, at) {
      await admin.from(SL_TABLES.notifications).update({ slack_ts: slackTs, sent_at: at }).eq("id", id);
    },
    async release(id) {
      await admin.from(SL_TABLES.notifications).delete().eq("id", id).is("sent_at", null);
    },
  };
}

// ── The message ────────────────────────────────────────────

export type SongDmMessage = { text: string; blocks: unknown[] };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const STAGE_LABEL: Record<string, string> = {
  idea_entry: "Idea / Entry",
  writing: "Writing",
  set_down: "Set down",
  refine: "Refine",
  written_needs_demo: "Written, needs demo",
  demo_ready: "Demo ready",
  share: "Share",
  celebrate: "Celebrate",
};
const ENTRY_LABEL: Record<string, string> = { lyric: "Lyric", melody: "Melody", instrumental: "Instrumental" };

function duration(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return "";
  const t = Math.round(s);
  return ` ${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export function buildUploadDm(input: {
  kind: UploadKind;
  title: string;
  uploader: string;
  entryPoint: string;
  stage: string;
  versionN: number;
  label: string | null;
  durationS: number | null;
  why: string;
  url: string;
  unsubscribeUrl: string;
}): SongDmMessage {
  const title = `“${esc(input.title)}”`;
  const headline =
    input.kind === "new_upload"
      ? `🎵 *${esc(input.uploader)}* uploaded a new song ${title} · started with ${ENTRY_LABEL[input.entryPoint] ?? esc(input.entryPoint)} · ${STAGE_LABEL[input.stage] ?? esc(input.stage)}`
      : `🎵 *${esc(input.uploader)}* uploaded version ${input.versionN} of ${title}`;
  const file = `${input.label ? esc(input.label) : `Version ${input.versionN}`}${duration(input.durationS)}`;
  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: `${headline}\n${file}`.slice(0, 2900) } },
    {
      type: "actions",
      elements: [
        { type: "button", action_id: "song_library_open_song", text: { type: "plain_text", text: "Listen in Hub" }, url: input.url },
        { type: "button", action_id: "song_library_subscriptions", text: { type: "plain_text", text: "Unsubscribe" }, url: input.unsubscribeUrl },
      ],
    },
    { type: "context", elements: [{ type: "mrkdwn", text: esc(input.why) }] },
  ];
  const text =
    input.kind === "new_upload"
      ? `${input.uploader} uploaded a new song “${input.title}”. ${input.url}`
      : `${input.uploader} uploaded version ${input.versionN} of “${input.title}”. ${input.url}`;
  return { text, blocks };
}

// ── Sending ────────────────────────────────────────────────

export interface SongDmDeps {
  sendSlackDm: (slackUserId: string, message: SongDmMessage) => Promise<{ ok: boolean; ts?: string | null; error?: string }>;
  slackReady: () => boolean;
  now: () => Date;
  log: (message: string) => void;
}

export const realSongDmDeps: SongDmDeps = {
  async sendSlackDm(slackUserId, message) {
    const conv = await slack.openConversation(slackUserId, "hub");
    const channel = conv.ok ? (conv as { channel?: { id: string } }).channel?.id : undefined;
    if (!channel) return { ok: false, error: (conv as { error?: string }).error || "no DM channel" };
    const sent = await slack.postMessage({ channel, text: message.text, blocks: message.blocks, bot: "hub" });
    return sent.ok ? { ok: true, ts: (sent as { ts?: string }).ts ?? null } : { ok: false, error: (sent as { error?: string }).error || "post failed" };
  },
  slackReady: () => isBotConfigured("hub"),
  now: () => new Date(),
  log: (message) => console.info(message),
};

export type SubscriberOutcome = "sent" | "already-sent" | "no-slack" | "unsupported" | "error";

export type SongDmRun = {
  outcome: "off" | "not-found" | "done" | "error";
  kind?: UploadKind;
  results: { user_id: string; reason: SongNotificationReason; outcome: SubscriberOutcome; error?: string }[];
};

type Person = { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null; slack_user_id: string | null };

const nameOf = (p: Person | undefined, fallback = "Someone") =>
  p ? [p.preferred_name || p.first_name, p.last_name].filter(Boolean).join(" ") || fallback : fallback;

/**
 * DM every subscriber about one uploaded version. Version 1 is the new
 * song; later numbers are new versions. Safe to call any number of times,
 * at the same time too. `admin` is the service-role client.
 */
export async function runSongUploadDms(
  admin: Client,
  versionId: string,
  opts: { deps?: SongDmDeps; env?: NodeJS.ProcessEnv; claims?: SongDmClaims } = {}
): Promise<SongDmRun> {
  const deps = opts.deps ?? realSongDmDeps;
  const env = opts.env ?? process.env;
  if (!canSendSongLibraryDm(env) || !deps.slackReady()) return { outcome: "off", results: [] };
  const claims = opts.claims ?? notificationClaims(admin);

  const v = await admin.from(SL_TABLES.versions).select("id, song_id, n, label, duration_s, uploaded_by").eq("id", versionId).maybeSingle();
  if (v.error) throw new Error(v.error.message);
  if (!v.data) return { outcome: "not-found", results: [] };
  const version = v.data as { id: string; song_id: string; n: number; label: string | null; duration_s: number | null; uploaded_by: string | null };
  const kind: UploadKind = version.n === 1 ? "new_upload" : "new_version";

  const [s, w] = await Promise.all([
    admin.from(SL_TABLES.songs).select("id, title, entry_point, stage").eq("id", version.song_id).maybeSingle(),
    admin.from(SL_TABLES.writers).select("user_id").eq("song_id", version.song_id),
  ]);
  if (s.error) throw new Error(s.error.message);
  if (w.error) throw new Error(w.error.message);
  if (!s.data) return { outcome: "not-found", results: [] };
  const song = s.data as { id: string; title: string; entry_point: string; stage: string };
  const writerIds = [...new Set(((w.data ?? []) as { user_id: string | null }[]).flatMap((r) => (r.user_id ? [r.user_id] : [])))];

  let versionEventId: string | null = null;
  if (kind === "new_version") {
    const ev = await admin
      .from(SL_TABLES.events)
      .select("id")
      .eq("song_id", song.id)
      .eq("kind", "version")
      .eq("payload->>version_id", version.id)
      .limit(1);
    if (ev.error) throw new Error(ev.error.message);
    versionEventId = ((ev.data ?? []) as { id: string }[])[0]?.id ?? null;
    if (!versionEventId) {
      deps.log(`[song-library-dm] version ${version.id}: no version event yet, nothing sent`);
      return { outcome: "error", kind, results: [] };
    }
  }

  // Who is subscribed, and why. A writer subscription wins over all_uploads (the more specific line).
  const subsAll = await admin.from(SL_TABLES.subscriptions).select("user_id").eq("target_type", "all_uploads");
  const subsWriter = writerIds.length
    ? await admin.from(SL_TABLES.subscriptions).select("user_id, target_user_id").eq("target_type", "writer").in("target_user_id", writerIds)
    : { data: [], error: null };
  if (subsAll.error) throw new Error(subsAll.error.message);
  if (subsWriter.error) throw new Error(subsWriter.error.message);
  const reasons = new Map<string, { reason: SongNotificationReason; writer?: string }>();
  for (const r of (subsAll.data ?? []) as { user_id: string }[]) reasons.set(r.user_id, { reason: "all_uploads" });
  for (const r of (subsWriter.data ?? []) as { user_id: string; target_user_id: string }[]) {
    if (reasons.get(r.user_id)?.reason !== "writer") reasons.set(r.user_id, { reason: "writer", writer: r.target_user_id });
  }
  if (version.uploaded_by) reasons.delete(version.uploaded_by);
  const recipients = [...reasons.keys()].sort();
  if (!recipients.length) return { outcome: "done", kind, results: [] };

  const peopleIds = [...new Set([...recipients, ...writerIds, ...(version.uploaded_by ? [version.uploaded_by] : [])])];
  const people = await admin.from("users").select("id, first_name, last_name, preferred_name, slack_user_id").in("id", peopleIds);
  if (people.error) throw new Error(people.error.message);
  const byId = new Map<string, Person>(((people.data ?? []) as Person[]).map((p) => [p.id, p]));
  const uploader = nameOf(version.uploaded_by ? byId.get(version.uploaded_by) : undefined);
  const url = songUrl(song.id, env);
  const unsubscribeUrl = subscriptionsUrl(env);

  const results: SongDmRun["results"] = [];
  for (const userId of recipients) {
    const why = reasons.get(userId)!;
    const person = byId.get(userId);
    if (!person?.slack_user_id) {
      deps.log(`[song-library-dm] version ${version.id}: user ${userId} has no Slack id, skipped`);
      results.push({ user_id: userId, reason: why.reason, outcome: "no-slack" });
      continue;
    }
    const claim = await claims.claim({ userId, songId: song.id, kind, versionEventId, reason: why.reason });
    if (claim.outcome === "taken") {
      results.push({ user_id: userId, reason: why.reason, outcome: "already-sent" });
      continue;
    }
    if (claim.outcome === "unsupported") {
      deps.log(`[song-library-dm] version ${version.id}: no claim column for new versions yet (419), DM to ${userId} not sent`);
      results.push({ user_id: userId, reason: why.reason, outcome: "unsupported" });
      continue;
    }
    if (claim.outcome === "error") {
      deps.log(`[song-library-dm] version ${version.id}: claim failed for ${userId}: ${claim.error}`);
      results.push({ user_id: userId, reason: why.reason, outcome: "error", error: "claim failed" });
      continue;
    }
    const message = buildUploadDm({
      kind,
      title: song.title,
      uploader,
      entryPoint: song.entry_point,
      stage: song.stage,
      versionN: version.n,
      label: version.label,
      durationS: version.duration_s === null ? null : Number(version.duration_s),
      why:
        why.reason === "writer"
          ? `You get this because you subscribe to ${nameOf(byId.get(why.writer!), "a writer on this song")}.`
          : "You get this because you follow all uploads.",
      url,
      unsubscribeUrl,
    });
    const sent = await deps
      .sendSlackDm(person.slack_user_id, message)
      .catch((err: unknown) => ({ ok: false as const, ts: null, error: String((err as Error)?.message || err) }));
    if (sent.ok) {
      await claims.markSent(claim.id, sent.ts ?? null, deps.now().toISOString()).catch((err: unknown) => deps.log(`[song-library-dm] mark sent failed: ${String(err)}`));
      results.push({ user_id: userId, reason: why.reason, outcome: "sent" });
      continue;
    }
    await claims.release(claim.id).catch(() => undefined);
    deps.log(`[song-library-dm] version ${version.id}: DM to ${userId} failed: ${sent.error ?? "unknown"}`);
    results.push({ user_id: userId, reason: why.reason, outcome: "error", error: sent.error });
  }
  return { outcome: "done", kind, results };
}
