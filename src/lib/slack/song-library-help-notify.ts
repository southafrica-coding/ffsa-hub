// Slack DMs to helpers when a writer asks for help on a song (419).
//
// Recipients: everyone with a song_library_helpers row for at least one of
// the help request's categories, minus whoever asked. Someone without a
// Slack id is skipped and logged (no claim, so a later run can reach them
// once they link Slack).
//
// Exactly once per (help request, helper): a song_library_notifications
// row with kind 'help_asked' and reason 'helper_category' is claimed
// first; 419's partial unique index song_library_notifications_help_asked_key
// on (user_id, help_request_id) makes a second claim a 23505, read as
// "already sent". The DM goes out only after the claim; if Slack fails the
// claim is released so a retry can send it. Production only, the same
// gate as the new-song DMs (canSendSongLibraryDm).
//
// Repeat limit: a helper who already has a help_asked claim for the SAME
// song, from another help request, made within HELP_DM_REPEAT_WINDOW_MS,
// covering every category they would be DMed about now, is skipped
// ("recently-sent", no claim). So opening several help requests for the
// same song and category does not re-DM the same helpers. A new category,
// another song, or the window passing DMs them again. Uses 419's claims
// (song_library_notifications); no new table. Residual: two requests
// created at the same instant can both pass the check before either has
// claimed (at most one extra DM each).

import { SL_TABLES, type Client } from "@/lib/song-library/types";
import { canSendSongLibraryDm, realSongDmDeps, songUrl, type ClaimResult, type SongDmDeps, type SongDmMessage } from "./song-library-notify";

const HELP_LABEL: Record<string, string> = {
  vocals: "Vocals",
  keys: "Keys",
  guitar: "Guitar",
  bass: "Bass",
  drums: "Drums",
  demo_production: "Demo production",
  lyric_feedback: "Lyric feedback",
  charts: "Charts",
};
const label = (c: string) => HELP_LABEL[c] ?? c;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function appBase(env: NodeJS.ProcessEnv): string {
  return (env.NEXT_PUBLIC_APP_URL || env.NEXT_PUBLIC_SITE_URL || "https://www.ffsahub.com").replace(/\/+$/, "");
}

/** Hub UI's helpers page (#745), where "I can help" and the helper categories live. */
export function helpersUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${appBase(env)}/song-library/helpers`;
}

// ── Claims ─────────────────────────────────────────────────

export type HelpClaimKey = { userId: string; songId: string; helpRequestId: string };

export interface HelpDmClaims {
  claim(key: HelpClaimKey): Promise<ClaimResult>;
  markSent(id: string, slackTs: string | null, at: string): Promise<void>;
  release(id: string): Promise<void>;
}

/** 419's song_library_notifications as the claim store, kind 'help_asked'. */
export function helpAskedClaims(admin: Client): HelpDmClaims {
  return {
    async claim(key) {
      const ins = await admin
        .from(SL_TABLES.notifications)
        .insert({ user_id: key.userId, song_id: key.songId, kind: "help_asked", help_request_id: key.helpRequestId, reason: "helper_category" })
        .select("id")
        .single();
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

export function buildHelpAskedDm(input: { asker: string; title: string; categories: string[]; matched: string[]; body: string; url: string; helpersUrl: string }): SongDmMessage {
  const needs = input.categories.map(label).join(", ");
  const body = input.body.length > 500 ? `${input.body.slice(0, 497)}…` : input.body;
  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: `🙋 *${esc(input.asker)}* is asking for help on “${esc(input.title)}” · ${esc(needs)}\n>${esc(body).replace(/\n/g, "\n>")}`.slice(0, 2900) } },
    {
      type: "actions",
      elements: [
        { type: "button", action_id: "song_library_open_song", text: { type: "plain_text", text: "Open the song" }, url: input.url },
        { type: "button", action_id: "song_library_helpers", text: { type: "plain_text", text: "I can help" }, url: input.helpersUrl },
      ],
    },
    { type: "context", elements: [{ type: "mrkdwn", text: esc(`You get this because you signed up to help with ${input.matched.map(label).join(", ")}. Change that on the Helpers page.`) }] },
  ];
  return { text: `${input.asker} is asking for help on “${input.title}” (${needs}). ${input.url}`, blocks };
}

// ── Repeat limit ───────────────────────────────────────────

/** How long a help DM for a song and category stops another one to the same helper. */
export const HELP_DM_REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Per helper, the categories they were already DMed (or are being DMed)
 * about for this song by another help request since `since`.
 */
export async function recentHelpCategories(
  admin: Client,
  input: { songId: string; helpRequestId: string; userIds: string[]; since: string }
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!input.userIds.length) return out;
  const recent = await admin
    .from(SL_TABLES.notifications)
    .select("user_id, help_request_id")
    .eq("kind", "help_asked")
    .eq("song_id", input.songId)
    .in("user_id", input.userIds)
    .neq("help_request_id", input.helpRequestId)
    .gte("created_at", input.since);
  if (recent.error) throw new Error(recent.error.message);
  const rows = (recent.data ?? []) as { user_id: string; help_request_id: string }[];
  if (!rows.length) return out;
  const reqs = await admin.from(SL_TABLES.helpRequests).select("id, categories").in("id", [...new Set(rows.map((r) => r.help_request_id))]);
  if (reqs.error) throw new Error(reqs.error.message);
  const cats = new Map(((reqs.data ?? []) as { id: string; categories: string[] }[]).map((r) => [r.id, r.categories ?? []]));
  for (const r of rows) {
    const set = out.get(r.user_id) ?? new Set<string>();
    for (const c of cats.get(r.help_request_id) ?? []) set.add(c);
    out.set(r.user_id, set);
  }
  return out;
}

// ── Sending ────────────────────────────────────────────────

export type HelperOutcome = "sent" | "already-sent" | "recently-sent" | "no-slack" | "error";

export type HelpDmRun = {
  outcome: "off" | "not-found" | "closed" | "done";
  results: { user_id: string; outcome: HelperOutcome; categories: string[]; error?: string }[];
};

type Person = { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null; slack_user_id: string | null };
const nameOf = (p: Person | undefined) => (p ? [p.preferred_name || p.first_name, p.last_name].filter(Boolean).join(" ") || "A writer" : "A writer");

/**
 * DM every helper signed up for one of a help request's categories. Safe to
 * call any number of times, at the same time too. `admin` is the
 * service-role client.
 */
export async function runHelpAskedDms(
  admin: Client,
  helpRequestId: string,
  opts: { deps?: SongDmDeps; env?: NodeJS.ProcessEnv; claims?: HelpDmClaims } = {}
): Promise<HelpDmRun> {
  const deps = opts.deps ?? realSongDmDeps;
  const env = opts.env ?? process.env;
  if (!canSendSongLibraryDm(env) || !deps.slackReady()) return { outcome: "off", results: [] };
  const claims = opts.claims ?? helpAskedClaims(admin);

  const r = await admin.from(SL_TABLES.helpRequests).select("id, song_id, asked_by, categories, body, status").eq("id", helpRequestId).maybeSingle();
  if (r.error) throw new Error(r.error.message);
  if (!r.data) return { outcome: "not-found", results: [] };
  const request = r.data as { id: string; song_id: string; asked_by: string | null; categories: string[]; body: string; status: string };
  if (request.status !== "open") return { outcome: "closed", results: [] };

  const [s, h] = await Promise.all([
    admin.from(SL_TABLES.songs).select("id, title").eq("id", request.song_id).maybeSingle(),
    admin.from(SL_TABLES.helpers).select("user_id, category").in("category", request.categories),
  ]);
  if (s.error) throw new Error(s.error.message);
  if (h.error) throw new Error(h.error.message);
  if (!s.data) return { outcome: "not-found", results: [] };
  const song = s.data as { id: string; title: string };

  const matched = new Map<string, string[]>();
  for (const row of (h.data ?? []) as { user_id: string; category: string }[]) {
    if (row.user_id === request.asked_by) continue;
    matched.set(row.user_id, [...(matched.get(row.user_id) ?? []), row.category]);
  }
  const recipients = [...matched.keys()].sort();
  if (!recipients.length) return { outcome: "done", results: [] };

  const people = await admin
    .from("users")
    .select("id, first_name, last_name, preferred_name, slack_user_id")
    .in("id", [...recipients, ...(request.asked_by ? [request.asked_by] : [])]);
  if (people.error) throw new Error(people.error.message);
  const byId = new Map<string, Person>(((people.data ?? []) as Person[]).map((p) => [p.id, p]));
  const asker = nameOf(request.asked_by ? byId.get(request.asked_by) : undefined);
  const url = songUrl(song.id, env);
  const helpers = helpersUrl(env);
  const since = new Date(deps.now().getTime() - HELP_DM_REPEAT_WINDOW_MS).toISOString();
  const recent = await recentHelpCategories(admin, { songId: song.id, helpRequestId: request.id, userIds: recipients, since });

  const results: HelpDmRun["results"] = [];
  for (const userId of recipients) {
    const cats = request.categories.filter((c) => matched.get(userId)!.includes(c));
    const person = byId.get(userId);
    if (!person?.slack_user_id) {
      deps.log(`[song-library-dm] help ${request.id}: user ${userId} has no Slack id, skipped`);
      results.push({ user_id: userId, outcome: "no-slack", categories: cats });
      continue;
    }
    const already = recent.get(userId);
    if (already && cats.every((c) => already.has(c))) {
      results.push({ user_id: userId, outcome: "recently-sent", categories: cats });
      continue;
    }
    const claim = await claims.claim({ userId, songId: song.id, helpRequestId: request.id });
    if (claim.outcome === "taken") {
      results.push({ user_id: userId, outcome: "already-sent", categories: cats });
      continue;
    }
    if (claim.outcome !== "claimed") {
      deps.log(`[song-library-dm] help ${request.id}: claim failed for ${userId}: ${claim.outcome === "error" ? claim.error : claim.outcome}`);
      results.push({ user_id: userId, outcome: "error", categories: cats, error: "claim failed" });
      continue;
    }
    const message = buildHelpAskedDm({ asker, title: song.title, categories: request.categories, matched: cats, body: request.body, url, helpersUrl: helpers });
    const sent = await deps
      .sendSlackDm(person.slack_user_id, message)
      .catch((err: unknown) => ({ ok: false as const, ts: null, error: String((err as Error)?.message || err) }));
    if (sent.ok) {
      await claims.markSent(claim.id, sent.ts ?? null, deps.now().toISOString()).catch((err: unknown) => deps.log(`[song-library-dm] mark sent failed: ${String(err)}`));
      results.push({ user_id: userId, outcome: "sent", categories: cats });
      continue;
    }
    await claims.release(claim.id).catch((err: unknown) => deps.log(`[song-library-dm] release failed: ${String(err)}`));
    deps.log(`[song-library-dm] help ${request.id}: DM to ${userId} failed: ${sent.error ?? "unknown"}`);
    results.push({ user_id: userId, outcome: "error", categories: cats, error: sent.error ?? "send failed" });
  }
  return { outcome: "done", results };
}
