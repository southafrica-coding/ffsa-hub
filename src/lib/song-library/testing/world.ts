// Test-only: the Song Library in memory, shaped like 419: its RLS, helper
// functions and the triggers the API relies on (lead writer on upload,
// stage events, version numbering, credit locks and sign-off rules,
// sign-ups only on open requests). Who manages comes from service_owners
// rows, as in 419: P&W holds the grants in the default world; a test can
// point them at another ministry to show nothing names P&W.

import { createMemoryDb, type DbErr, type Hooks, type MemoryDb, type Rls, type Row } from "./memory-db";

export const PW_ID = "00000000-0000-4000-8000-00000000a001";
export const MEDIA_ID = "00000000-0000-4000-8000-00000000a002";

export const WRITER = "00000000-0000-4000-8000-00000000c001"; // lead writer of SONG, not in P&W
export const COWRITER = "00000000-0000-4000-8000-00000000c002"; // co-writer on SONG, not in P&W
export const PW_MEMBER = "00000000-0000-4000-8000-00000000c003"; // P&W member: a manager
export const PW_LEADER = "00000000-0000-4000-8000-00000000c004"; // P&W leader: manager and lead
export const BASE = "00000000-0000-4000-8000-00000000c005"; // anyone on the base
export const ADMIN = "00000000-0000-4000-8000-00000000c006";
export const MEDIA_LEAD = "00000000-0000-4000-8000-00000000c007"; // leads Media, nothing to do with songs
export const SUB_ALL = "00000000-0000-4000-8000-00000000c008"; // follows all uploads
export const SUB_WRITER = "00000000-0000-4000-8000-00000000c009"; // follows COWRITER (and all uploads)
export const SUB_NOSLACK = "00000000-0000-4000-8000-00000000c00a"; // follows all uploads, no Slack id

export const SONG = "00000000-0000-4000-8000-00000000d001"; // stage writing
export const DEMO_SONG = "00000000-0000-4000-8000-00000000d002"; // stage demo_ready
export const W_LEAD = "00000000-0000-4000-8000-00000000e001";
export const W_CO = "00000000-0000-4000-8000-00000000e002";
export const W_GUEST = "00000000-0000-4000-8000-00000000e003"; // no Hub account
export const W_DEMO = "00000000-0000-4000-8000-00000000e004";
export const V1 = "00000000-0000-4000-8000-00000000f001";
export const HELP = "00000000-0000-4000-8000-00000000f101";

const EARLY = ["idea_entry", "writing", "set_down", "refine", "written_needs_demo"];
const T = {
  songs: "song_library_songs",
  versions: "song_library_versions",
  events: "song_library_stage_events",
  writers: "song_library_writers",
  checkpoints: "song_library_checkpoints",
  celebrate: "song_library_celebrate_notes",
};

const song = (id: string, title: string, stage: string, created_by: string) => ({
  id,
  title,
  created_by,
  entry_point: "melody",
  pathway: "b1",
  holy_spirit_interrupt: false,
  stage,
  placement: "inbox",
  music_key: null,
  bpm: null,
  lyrics_md: null,
  chart_path: null,
  current_version_id: null,
  visibility: "base",
  source_training_id: null,
  last_activity_at: "2026-11-20T10:00:00.000Z",
  created_at: "2026-11-01T10:00:00.000Z",
  updated_at: "2026-11-01T10:00:00.000Z",
});

const writer = (id: string, song_id: string, user_id: string | null, split_pct: number | null, is_lead = false, display_name: string | null = null) => ({
  id,
  song_id,
  user_id,
  display_name,
  role: null,
  is_lead,
  split_pct,
  added_by: null,
  confirmed_at: null,
  confirmed_by: null,
  created_at: `2026-11-01T10:00:0${is_lead ? 0 : id.endsWith("2") ? 1 : 2}.000Z`,
  updated_at: "2026-11-01T10:00:00.000Z",
});

export type SongWorld = MemoryDb & { rls: Rls; isManager: (uid: string | null) => boolean; agreed: (songId: string) => boolean };

export function makeSongWorld(extra: Record<string, Row[]> = {}): SongWorld {
  const seed: Record<string, Row[]> = {
    staff_ministries: [
      { id: PW_ID, slug: "prayer_and_worship", is_active: true },
      { id: MEDIA_ID, slug: "media", is_active: true },
    ],
    staff_ministry_members: [
      { user_id: PW_MEMBER, staff_ministry_id: PW_ID, member_role: "member", status: "active" },
      { user_id: PW_LEADER, staff_ministry_id: PW_ID, member_role: "leader", status: "active" },
      { user_id: MEDIA_LEAD, staff_ministry_id: MEDIA_ID, member_role: "leader", status: "active" },
    ],
    service_owners: [
      { service_key: "song_library", staff_ministry_id: PW_ID, capability: "own", member_role: "member", open_to_all: false },
      { service_key: "song_library", staff_ministry_id: PW_ID, capability: "manage", member_role: "member", open_to_all: false },
      { service_key: "song_library", staff_ministry_id: null, capability: "use", member_role: null, open_to_all: true },
    ],
    users: [
      { id: WRITER, first_name: "Dani", last_name: "Blood", preferred_name: null, slack_user_id: "U_WRITER" },
      { id: COWRITER, first_name: "Noah", last_name: "Lind", preferred_name: null, slack_user_id: "U_COWRITER" },
      { id: PW_MEMBER, first_name: "Kiri", last_name: "Vos", preferred_name: null, slack_user_id: "U_PWM" },
      { id: PW_LEADER, first_name: "Lerato", last_name: "M", preferred_name: null, slack_user_id: "U_PWL" },
      { id: BASE, first_name: "Ben", last_name: "S", preferred_name: null, slack_user_id: "U_BASE" },
      { id: ADMIN, first_name: "Ada", last_name: "A", preferred_name: null, slack_user_id: "U_ADMIN" },
      { id: MEDIA_LEAD, first_name: "Mo", last_name: "D", preferred_name: null, slack_user_id: "U_MEDIA" },
      { id: SUB_ALL, first_name: "Sam", last_name: "All", preferred_name: null, slack_user_id: "U_SUB_ALL" },
      { id: SUB_WRITER, first_name: "Wes", last_name: "Fan", preferred_name: null, slack_user_id: "U_SUB_WRITER" },
      { id: SUB_NOSLACK, first_name: "Nia", last_name: "Q", preferred_name: null, slack_user_id: null },
    ],
    [T.songs]: [song(SONG, "Harbour Lights", "writing", WRITER), song(DEMO_SONG, "Mercy Like Morning", "demo_ready", WRITER)],
    [T.writers]: [
      writer(W_LEAD, SONG, WRITER, 50, true),
      writer(W_CO, SONG, COWRITER, 40),
      writer(W_GUEST, SONG, null, 10, false, "Guest Writer"),
      writer(W_DEMO, DEMO_SONG, WRITER, 100, true),
    ],
    [T.versions]: [
      { id: V1, song_id: SONG, n: 1, label: "verse idea", storage_path: `${SONG}/v-00000000-0000-4000-8000-000000000001.mp3`, mime_type: "audio/mpeg", size_bytes: 1000, duration_s: 102, is_demo: false, isrc: null, uploaded_by: WRITER, uploaded_at: "2026-11-01T10:00:00.000Z", updated_at: "2026-11-01T10:00:00.000Z" },
    ],
    [T.events]: [],
    [T.checkpoints]: [],
    [T.celebrate]: [{ song_id: SONG, prompt_no: 1, body: "We wrote this after the prayer night", by_user: WRITER, created_at: "2026-11-02T10:00:00.000Z", updated_at: "2026-11-02T10:00:00.000Z" }],
    song_library_publishing: [],
    song_library_helpers: [{ user_id: BASE, category: "bass", note: null, created_at: "2026-11-01T10:00:00.000Z" }],
    song_library_help_requests: [
      { id: HELP, song_id: SONG, asked_by: WRITER, categories: ["bass", "drums"], body: "For the demo", status: "open", helper_user_id: null, closed_at: null, created_at: "2026-11-03T10:00:00.000Z", updated_at: "2026-11-03T10:00:00.000Z" },
    ],
    song_library_help_signups: [],
    song_library_subscriptions: [
      { id: "s1", user_id: SUB_ALL, target_type: "all_uploads", target_user_id: null, created_at: "2026-11-01T10:00:00.000Z" },
      { id: "s2", user_id: SUB_WRITER, target_type: "writer", target_user_id: COWRITER, created_at: "2026-11-01T10:00:00.000Z" },
      { id: "s3", user_id: SUB_WRITER, target_type: "all_uploads", target_user_id: null, created_at: "2026-11-01T10:00:00.000Z" },
      { id: "s4", user_id: SUB_NOSLACK, target_type: "all_uploads", target_user_id: null, created_at: "2026-11-01T10:00:00.000Z" },
      { id: "s5", user_id: WRITER, target_type: "all_uploads", target_user_id: null, created_at: "2026-11-01T10:00:00.000Z" },
    ],
    song_library_notifications: [],
    ...extra,
  };

  // eslint-disable-next-line prefer-const -- assigned once below; the hooks above close over it
  let db: MemoryDb;
  const tbl = (t: string) => db.raw(t);
  const isAdmin = (uid: string | null) => uid === ADMIN;
  const grantMinistries = (caps: string[]) =>
    tbl("service_owners")
      .filter((g) => g.service_key === "song_library" && caps.includes(g.capability as string) && !g.open_to_all && g.staff_ministry_id)
      .map((g) => g.staff_ministry_id as string);
  const memberOf = (uid: string | null, ministry: string, leadersOnly = false) =>
    !!uid && tbl("staff_ministry_members").some((m) => m.user_id === uid && m.staff_ministry_id === ministry && m.status === "active" && (!leadersOnly || m.member_role === "leader"));
  const isManager = (uid: string | null) => grantMinistries(["manage"]).some((m) => memberOf(uid, m));
  const isWriter = (uid: string | null, songId: unknown) => !!uid && tbl(T.writers).some((w) => w.song_id === songId && w.user_id === uid);
  const agreed = (songId: string) => {
    const ws = tbl(T.writers).filter((w) => w.song_id === songId);
    return ws.length > 0 && ws.every((w) => w.split_pct !== null && w.confirmed_at) && Math.round(ws.reduce((s, w) => s + Number(w.split_pct), 0) * 100) === 10000;
  };
  const ticked = (songId: unknown) => tbl(T.checkpoints).some((c) => c.song_id === songId && c.kind === "credits_splits_agreed" && c.done_at);
  const event = (song_id: unknown, kind: string, by_user: string | null, extraCols: Row = {}) =>
    tbl(T.events).push({ id: `ev-${tbl(T.events).length + 1}-${String(song_id).slice(-4)}`, song_id, kind, from_stage: null, to_stage: null, payload: {}, by_user, at: new Date(Date.UTC(2026, 10, 26, 18, 0, tbl(T.events).length)).toISOString(), note: null, ...extraCols });
  const syncAgreed = (songId: string) => {
    const list = tbl(T.checkpoints);
    const row = list.find((c) => c.song_id === songId && c.kind === "credits_splits_agreed");
    if (agreed(songId)) {
      if (row) row.done_at ??= "2026-11-26T18:00:00.000Z";
      else list.push({ song_id: songId, kind: "credits_splits_agreed", done_at: "2026-11-26T18:00:00.000Z", by_user: null, note: null });
    } else if (row) row.done_at = null;
  };
  const refuse = (code: string, message: string): DbErr => ({ code, message });
  const CREDIT = ["user_id", "display_name", "role", "is_lead", "split_pct"];

  const rls: Rls = {
    read(table, row, uid) {
      if (!uid) return false;
      if (["users", "staff_ministries", "staff_ministry_members", "service_owners", "audit_logs"].includes(table)) return true;
      if (table === T.celebrate) return isAdmin(uid) || isManager(uid) || isWriter(uid, row.song_id);
      if (table === "song_library_subscriptions" || table === "song_library_notifications") return isAdmin(uid) || row.user_id === uid;
      return true;
    },
    write(table, row, uid) {
      if (!uid) return false;
      const a = isAdmin(uid);
      const m = isManager(uid);
      switch (table) {
        case T.songs:
          return a || m || row.created_by === uid || isWriter(uid, row.id);
        case T.versions:
        case T.celebrate:
        case "song_library_refine_items":
        case "song_library_pathway_steps":
        case "song_library_share_steps":
          return a || isWriter(uid, row.song_id);
        case T.writers:
          return a || m || isWriter(uid, row.song_id);
        case "song_library_publishing":
          return a || m || isWriter(uid, row.song_id);
        case T.events:
          return a || row.by_user === uid; // note only
        case T.checkpoints:
          return a || m;
        case "song_library_helpers":
        case "song_library_subscriptions":
          return a || row.user_id === uid;
        case "song_library_help_requests":
          return a || m || row.asked_by === uid;
        case "song_library_help_signups":
          return a || m || row.user_id === uid || tbl("song_library_help_requests").some((r) => r.id === row.request_id && r.asked_by === uid);
        case "song_library_notifications":
          return false; // service role only
        default:
          return false;
      }
    },
    rpc(name, args, uid) {
      if (name === "song_library_can_read") return !!uid;
      if (name === "song_library_can_manage") return isManager(uid);
      if (name === "song_library_is_admin") return isAdmin(uid);
      if (name === "dept_is_ministry_leader") return memberOf(uid, args.p_ministry_id as string, true);
      if (name === "song_library_writer_subscriber_count") return tbl("song_library_subscriptions").filter((s) => s.target_type === "writer" && s.target_user_id === args.p_writer_id).length;
      return false;
    },
    storageWrite: (path, uid) => isAdmin(uid) || isWriter(uid, path.split("/")[0]),
    storageRead: (_path, uid) => !!uid,
  };

  db = createMemoryDb(seed, {
    defaults: {
      [T.songs]: { stage: "idea_entry", placement: "inbox", pathway: null, holy_spirit_interrupt: false, chart_path: null, current_version_id: null, last_activity_at: "2026-11-26T18:00:00.000Z" },
      [T.writers]: { role: null, is_lead: false, split_pct: null, confirmed_at: null, confirmed_by: null, display_name: null, user_id: null },
      [T.versions]: { label: null, is_demo: false, isrc: null, duration_s: null },
      song_library_help_requests: { status: "open", helper_user_id: null, closed_at: null },
      song_library_notifications: { stage_event_id: null, help_request_id: null, slack_ts: null, sent_at: null },
    },
    unique: (table, row, all) => {
      if (table === T.writers && row.user_id && all.some((w) => w.song_id === row.song_id && w.user_id === row.user_id)) return "song_library_writers_song_user_key";
      if (table === "song_library_help_signups" && all.some((s) => s.request_id === row.request_id && s.user_id === row.user_id)) return "song_library_help_signups_request_user_key";
      if (table === "song_library_helpers" && all.some((h) => h.user_id === row.user_id && h.category === row.category)) return "song_library_helpers_pkey";
      if (table === "song_library_subscriptions" && all.some((s) => s.user_id === row.user_id && s.target_type === row.target_type && s.target_user_id === row.target_user_id))
        return row.target_type === "writer" ? "song_library_subscriptions_writer_key" : "song_library_subscriptions_all_uploads_key";
      // 419 primary keys on the progress tables.
      const pk: Record<string, string> = { song_library_refine_items: "q_no", song_library_pathway_steps: "step", song_library_share_steps: "kind", song_library_checkpoints: "kind" };
      if (pk[table] && all.some((r) => r.song_id === row.song_id && r[pk[table]] === row[pk[table]])) return `${table}_pkey`;
      if (table === "song_library_notifications") {
        if (row.kind === "new_upload" && all.some((n) => n.kind === "new_upload" && n.user_id === row.user_id && n.song_id === row.song_id)) return "song_library_notifications_new_upload_key";
        if (row.kind === "new_version" && all.some((n) => n.kind === "new_version" && n.user_id === row.user_id && n.stage_event_id === row.stage_event_id)) return "song_library_notifications_new_version_key";
      }
      return true;
    },
    hooks: {
      [T.songs]: {
        before(op, row, old, { uid }) {
          if (op === "insert") {
            row.visibility = "base";
            row.current_version_id = null;
            if (uid) {
              row.created_by = uid;
              if (!(isAdmin(uid) || isManager(uid))) {
                row.stage = "idea_entry";
                row.placement = "inbox";
              }
            }
            return;
          }
          if (op !== "update" || !old || !uid || isAdmin(uid)) return;
          for (const col of ["id", "created_by", "created_at", "visibility"]) if (row[col] !== old[col]) return refuse("42501", `song_library_songs.${col} is set by the Hub`);
          const m = isManager(uid);
          const w = isWriter(uid, old.id);
          if (row.placement !== old.placement && !m) return refuse("42501", "Only Song Library managers can change placement");
          if (row.stage !== old.stage && !m) {
            if (!w) return refuse("42501", "Only the song's writers or Song Library managers can move its stage");
            if (!(EARLY.includes(old.stage as string) && EARLY.includes(row.stage as string))) return refuse("42501", "Only Song Library managers can move a song into or out of demo_ready, share or celebrate");
          }
          const skip = ["stage", "placement", "updated_at", "last_activity_at"];
          if (Object.keys(row).some((k) => !skip.includes(k) && JSON.stringify(row[k]) !== JSON.stringify(old[k])) && !w) return refuse("42501", "Only the song's writers can edit it");
        },
        after(op, row, old, { uid }) {
          if (op === "insert") {
            if (row.created_by) tbl(T.writers).push({ ...writer(`w-${String(row.id).slice(-6)}`, row.id as string, row.created_by as string, null, true), added_by: row.created_by });
            event(row.id, "stage", uid ?? (row.created_by as string), { to_stage: row.stage, payload: { created: true } });
          } else if (op === "update" && old) {
            if (row.stage !== old.stage) event(row.id, "stage", uid, { from_stage: old.stage, to_stage: row.stage });
            if (row.placement !== old.placement) event(row.id, "placement", uid, { payload: { from: old.placement, to: row.placement } });
          } else if (op === "delete") {
            for (const t of [T.writers, T.versions, T.events, T.celebrate, T.checkpoints, "song_library_help_requests", "song_library_refine_items", "song_library_pathway_steps", "song_library_share_steps"]) {
              db.tables[t] = tbl(t).filter((r) => r.song_id !== row.id);
            }
          }
        },
      },
      [T.versions]: {
        before(op, row, old, { uid }) {
          if (op === "insert") {
            row.n = Math.max(0, ...tbl(T.versions).filter((v) => v.song_id === row.song_id).map((v) => v.n as number)) + 1;
            if (uid) row.uploaded_by = uid;
          }
        },
        after(op, row, _old, { uid }) {
          if (op !== "insert") return;
          event(row.song_id, "version", uid ?? (row.uploaded_by as string), { payload: { version_id: row.id, n: row.n, label: row.label } });
          const s = tbl(T.songs).find((x) => x.id === row.song_id);
          if (s && !s.current_version_id) s.current_version_id = row.id;
        },
      },
      [T.writers]: {
        before(op, row, old, { uid }) {
          const songId = (op === "delete" ? old!.song_id : row.song_id) as string;
          const creditChange = op !== "update" || CREDIT.some((c) => row[c] !== old![c]);
          if (creditChange && ticked(songId)) return refuse("23514", "Credits are agreed for this song; revoke the agreement (un-confirm) before changing writers or splits");
          if (op === "delete") return;
          if (op === "insert") {
            if (uid) row.added_by = uid;
            row.confirmed_at = null;
            row.confirmed_by = null;
            return;
          }
          if (uid && !isAdmin(uid) && !isWriter(uid, old!.song_id)) {
            const changed = Object.keys(row).filter((k) => !["confirmed_at", "confirmed_by", "updated_at"].includes(k) && row[k] !== old![k]);
            if (changed.length) return refuse("42501", "Managers who are not writers can only confirm splits for writers without a Hub account");
          }
          if (creditChange) {
            row.confirmed_at = null;
            row.confirmed_by = null;
            return;
          }
          if (row.confirmed_at !== old!.confirmed_at) {
            if (row.confirmed_at) {
              if (row.split_pct === null) return refuse("23514", "Give this writer a split before confirming it");
              if (uid && old!.user_id && old!.user_id !== uid) return refuse("42501", "Only that writer can confirm their own split");
              if (uid && !old!.user_id && !(isAdmin(uid) || isManager(uid))) return refuse("42501", "A writer without a Hub account is confirmed by a Song Library manager or an admin");
              row.confirmed_by = uid ?? row.confirmed_by;
            } else {
              if (uid && old!.user_id !== uid && !(isAdmin(uid) || isManager(uid))) return refuse("42501", "Only that writer, a Song Library manager or an admin can withdraw this confirmation");
              row.confirmed_by = null;
            }
          }
        },
        after(op, row, old) {
          const songId = (op === "delete" ? old!.song_id : row.song_id) as string;
          const creditChange = op !== "update" || CREDIT.some((c) => row[c] !== old![c]);
          const wasTicked = ticked(songId);
          if (creditChange) for (const w of tbl(T.writers)) if (w.song_id === songId) { w.confirmed_at = null; w.confirmed_by = null; }
          syncAgreed(songId);
          if (wasTicked && !ticked(songId)) {
            // 419 checkpoints_log: revoking clears every confirmation.
            for (const w of tbl(T.writers)) if (w.song_id === songId) { w.confirmed_at = null; w.confirmed_by = null; }
            event(songId, "checkpoint", null, { payload: { checkpoint: "credits_splits_agreed", done: false, revoked: true } });
          }
        },
      },
      [T.checkpoints]: {
        // 419 song_library_checkpoints_guard + _log.
        before(op, row, old, { uid }) {
          if (!uid) return;
          if (op === "insert" && row.kind === "credits_splits_agreed") return refuse("42501", "credits_splits_agreed follows the writers' confirmations; confirm splits instead");
          if (op === "update" && old!.kind === "credits_splits_agreed" && (row.done_at !== null || row.note !== old!.note)) return refuse("42501", "credits_splits_agreed can only be revoked (unticked) by hand");
          if (op !== "delete") row.by_user = uid;
        },
        after(op, row, old) {
          const was = old ?? row;
          if (was.kind !== "credits_splits_agreed" || !old?.done_at) return;
          if (op === "delete" || !row.done_at) {
            for (const w of tbl(T.writers)) if (w.song_id === was.song_id) { w.confirmed_at = null; w.confirmed_by = null; }
            event(was.song_id, "checkpoint", null, { payload: { checkpoint: "credits_splits_agreed", done: false, revoked: true } });
          }
        },
      },
      ...Object.fromEntries(
        ["song_library_refine_items", "song_library_pathway_steps", "song_library_share_steps"].map((t) => [
          t,
          {
            // 419 song_library_stamp_actor.
            before(op, row, _old, { uid }) {
              if (op === "delete" || !uid) return;
              row.by_user = uid;
              if (t === "song_library_refine_items") row.at = "2026-11-26T19:00:00.000Z";
            },
          } satisfies Hooks,
        ])
      ),
      song_library_help_requests: {
        before(op, row, _old, { uid }) {
          if (op === "insert" && uid) row.asked_by = uid;
          if (op !== "delete") row.closed_at = row.status === "open" ? null : (row.closed_at ?? "2026-11-26T18:00:00.000Z");
        },
      },
      song_library_help_signups: {
        before(op, row) {
          if (op === "insert" && !tbl("song_library_help_requests").some((r) => r.id === row.request_id && r.status === "open")) return refuse("23514", "This help request is no longer open");
        },
      },
    },
  });

  // 419's song_library_song_status view, computed on read.
  Object.defineProperty(db.tables, "song_library_song_status", {
    enumerable: true,
    get: () =>
      tbl(T.songs).map((s) => {
        const ws = tbl(T.writers).filter((w) => w.song_id === s.id);
        return {
          song_id: s.id,
          stage: s.stage,
          placement: s.placement,
          last_activity_at: s.last_activity_at,
          stuck_days: 6,
          stuck_after_days: s.stage === "celebrate" ? null : 14,
          is_stuck: false,
          is_finished: ["demo_ready", "share", "celebrate"].includes(s.stage as string),
          needs_demo: s.stage === "written_needs_demo",
          splits_agreed: agreed(s.id as string),
          splits_total_pct: ws.reduce((t, w) => t + Number(w.split_pct ?? 0), 0),
          writers_count: ws.length,
          writers_confirmed: ws.filter((w) => w.confirmed_at).length,
        };
      }),
  });

  return Object.assign(db, { rls, isManager, agreed });
}

/** Mark every writer on a song as signed off (as the trigger would leave it) and tick the checkpoint. */
export function agreeAll(db: SongWorld, songId: string) {
  for (const w of db.raw("song_library_writers")) if (w.song_id === songId) w.confirmed_at = "2026-11-25T10:00:00.000Z";
  db.raw("song_library_checkpoints").push({ song_id: songId, kind: "credits_splits_agreed", done_at: "2026-11-25T10:00:00.000Z", by_user: null, note: null });
}
