// Songs, the library home and board, stage and placement moves, uploads
// and versions. Shapes follow Hub UI's client (#745,
// components/song-library/api.ts and types.ts).
//
//   GET    /api/song-library                             LibraryHome { songs: SongListItem[], subscribedAllUploads }
//   GET    /api/song-library/board                       SongListItem[] (managers)
//   GET    /api/song-library/songs                       { songs: SongListItem[] } (?stage ?placement ?writer ?bucket=finished|in_process|needs_demo ?stuck=1 ?q)
//   POST   /api/song-library/songs                       upload a song (caller = lead writer), optional co_writers → 201 { song, writers, splits }
//   GET    /api/song-library/songs/:id                   SongDetail (+ shareSteps, splits, viewer, celebrateNotes)
//   PATCH  /api/song-library/songs/:id                   edit (writers) → { song }
//   DELETE /api/song-library/songs/:id                   delete (lead writer, admin)
//   POST   /api/song-library/songs/:id/stage             { to, from?, note? } → { song, changed, event }
//   POST   /api/song-library/songs/:id/placement         { to, from?, note? } → { song, changed, event }
//   POST   /api/song-library/songs/:id/uploads           { kind: audio|chart, filename, content_type, size } → signed upload
//   POST   /api/song-library/songs/:id/versions          { path, label?, is_demo?, duration_s? } after the upload landed; DMs subscribers
//   PATCH  /api/song-library/songs/:id/versions/:vid     { label?, is_demo?, isrc? }
//   DELETE /api/song-library/songs/:id/versions/:vid
//   GET    /api/song-library/songs/:id/versions/:vid/audio  { url, expires_in } short-lived signed read URL
//   GET    /api/song-library/versions/:vid/audio         302 to that signed URL (an <audio src>)
//
// Every stage or placement change writes a song_library_stage_events row
// (419's trigger); a note in the body is put on that event.

import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isUuid } from "@/lib/departments/validate";
import {
  allowedStages,
  canAskForHelp,
  canDeleteSong,
  canEditPublishing,
  canEditSong,
  canMoveStage,
  canReadCelebrate,
  canSeeBoard,
  canSetPlacement,
  canTickCheckpoint,
  canTickProgress,
} from "@/lib/song-library/access";
import { badRequest, coded, dbError, forbidden, notFound, serverError, invalid, tooLarge } from "@/lib/song-library/http";
import {
  SONG_UPLOAD_MAX_BYTES,
  isPlacement,
  parsePlacementMove,
  parseSongCreate,
  parseSongPatch,
  parseStageMove,
  parseUploadRequest,
  parseVersionCreate,
  parseVersionPatch,
} from "@/lib/song-library/validate";
import {
  SL_CODES,
  SL_REASONS,
  SL_COLUMNS,
  SL_TABLES,
  SONG_LIBRARY_BUCKET,
  SONG_STAGES,
  isStage,
  type Row,
  type SongLibrarySong,
  type SongLibraryWriter,
} from "@/lib/song-library/types";
import { runSongUploadDms } from "@/lib/slack/song-library-notify";
import type { SongLibraryContext } from "./context";
import { body, isLoaded, isOpen, listItems, namesFor, openSong, openSongLibrary, splitsState, withWriterNames, type LoadedSong, type SongListItem } from "./shared";

const notWriter = () => forbidden("Only the song's writers can do that", SL_REASONS.notWriter);

// ── List, home, board and detail ───────────────────────────

type ListFilter = { stage?: string | null; placement?: string | null; writer?: string | null; bucket?: string | null; stuck?: boolean; q?: string | null };

async function songItems(ctx: SongLibraryContext, f: ListFilter = {}) {
  let query = ctx.supabase.from(SL_TABLES.songs).select(SL_COLUMNS.songs);
  if (f.stage) query = query.eq("stage", f.stage);
  if (f.placement) query = query.eq("placement", f.placement);
  if (f.writer) {
    const mine = await ctx.supabase.from(SL_TABLES.writers).select("song_id").eq("user_id", f.writer);
    if (mine.error) return { ok: false as const, response: dbError(mine.error) };
    const ids = ((mine.data ?? []) as { song_id: string }[]).map((r) => r.song_id);
    if (!ids.length) return { ok: true as const, items: [] as SongListItem[] };
    query = query.in("id", ids);
  }
  const songs = await query.order("last_activity_at", { ascending: false }).limit(500);
  if (songs.error) return { ok: false as const, response: dbError(songs.error) };
  let rows = (songs.data ?? []) as SongLibrarySong[];
  const q = f.q?.trim().toLowerCase();
  if (q) rows = rows.filter((s) => s.title.toLowerCase().includes(q));
  const built = await listItems(ctx, rows);
  if (!built.ok) return built;
  let items = built.items;
  if (f.bucket === "finished") items = items.filter((i) => i.status?.is_finished === true);
  if (f.bucket === "needs_demo") items = items.filter((i) => i.status?.needs_demo === true);
  if (f.bucket === "in_process") items = items.filter((i) => i.status && !i.status.is_finished && !i.status.needs_demo);
  if (f.stuck) items = items.filter((i) => i.status?.is_stuck === true);
  return { ok: true as const, items };
}

/** GET /songs: { songs: SongListItem[] }. */
export async function listSongs(request: Request) {
  const ctx = await openSongLibrary();
  if (!isOpen(ctx)) return ctx.response;
  const p = new URL(request.url).searchParams;
  const f: ListFilter = { stage: p.get("stage"), placement: p.get("placement"), writer: p.get("writer"), bucket: p.get("bucket"), stuck: p.get("stuck") === "1", q: p.get("q") };
  if (f.stage && !isStage(f.stage)) return badRequest("Unknown stage", "stage");
  if (f.placement && !isPlacement(f.placement)) return badRequest("Unknown placement", "placement");
  if (f.writer && !isUuid(f.writer)) return badRequest("writer must be a user id", "writer");
  if (f.bucket && !["finished", "in_process", "needs_demo"].includes(f.bucket)) return badRequest("bucket must be finished, in_process or needs_demo", "bucket");
  const r = await songItems(ctx, f);
  if (!r.ok) return r.response;
  return NextResponse.json({ songs: r.items });
}

/** GET /api/song-library: Hub UI's LibraryHome { songs, subscribedAllUploads }. */
export async function libraryHome() {
  const ctx = await openSongLibrary();
  if (!isOpen(ctx)) return ctx.response;
  const [r, sub] = await Promise.all([
    songItems(ctx),
    ctx.supabase.from(SL_TABLES.subscriptions).select("id").eq("user_id", ctx.viewer.userId).eq("target_type", "all_uploads").limit(1),
  ]);
  if (!r.ok) return r.response;
  if (sub.error) return dbError(sub.error);
  return NextResponse.json({ songs: r.items, subscribedAllUploads: ((sub.data ?? []) as Row[]).length > 0 });
}

/** GET /board: SongListItem[] (a bare array, as Hub UI's client reads it). Managers and admins. */
export async function board() {
  const ctx = await openSongLibrary();
  if (!isOpen(ctx)) return ctx.response;
  if (!canSeeBoard(ctx.viewer)) return forbidden("The board is for Song Library managers", SL_REASONS.notManager);
  const r = await songItems(ctx);
  if (!r.ok) return r.response;
  return NextResponse.json(r.items);
}

/**
 * GET /songs/:id: Hub UI's SongDetail, plus shareSteps, splits, viewer
 * (what the caller may do) and, for writers and P&W only, celebrateNotes.
 */
export async function getSong(songId: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded.response;
  const { ctx, song, writers, role } = loaded;
  const s = ctx.supabase;
  const seeCelebrate = canReadCelebrate(ctx.viewer, role);
  const lead = writers.find((w) => w.is_lead) ?? writers[0];
  const [status, versions, publishing, checkpoints, events, help, pathway, refine, share, follows, celebrate] = await Promise.all([
    s.from(SL_TABLES.status).select(SL_COLUMNS.status).eq("song_id", song.id).maybeSingle(),
    s.from(SL_TABLES.versions).select(SL_COLUMNS.versions).eq("song_id", song.id).order("n", { ascending: true }),
    s.from(SL_TABLES.publishing).select(SL_COLUMNS.publishing).eq("song_id", song.id).maybeSingle(),
    s.from(SL_TABLES.checkpoints).select(SL_COLUMNS.checkpoints).eq("song_id", song.id),
    s.from(SL_TABLES.events).select(SL_COLUMNS.events).eq("song_id", song.id).order("at", { ascending: false }).limit(100),
    s.from(SL_TABLES.helpRequests).select(SL_COLUMNS.helpRequests).eq("song_id", song.id).order("created_at", { ascending: false }),
    s.from(SL_TABLES.pathway).select(SL_COLUMNS.pathway).eq("song_id", song.id),
    s.from(SL_TABLES.refine).select(SL_COLUMNS.refine).eq("song_id", song.id).order("q_no", { ascending: true }),
    s.from(SL_TABLES.share).select(SL_COLUMNS.share).eq("song_id", song.id),
    lead?.user_id && lead.user_id !== ctx.viewer.userId
      ? s.from(SL_TABLES.subscriptions).select("id").eq("user_id", ctx.viewer.userId).eq("target_type", "writer").eq("target_user_id", lead.user_id).limit(1)
      : Promise.resolve({ data: [], error: null }),
    seeCelebrate
      ? s.from(SL_TABLES.celebrate).select(SL_COLUMNS.celebrate).eq("song_id", song.id).order("prompt_no", { ascending: true })
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const r of [status, versions, publishing, checkpoints, events, help, pathway, refine, share, follows, celebrate]) if (r.error) return dbError(r.error);
  const helpRows = (help.data ?? []) as Row[];
  const signups = helpRows.length
    ? await s.from(SL_TABLES.helpSignups).select(SL_COLUMNS.helpSignups).in("request_id", helpRows.map((h) => h.id))
    : { data: [], error: null };
  if (signups.error) return dbError(signups.error);
  const signupRows = (signups.data ?? []) as Row[];
  const eventRows = (events.data ?? []) as Row[];
  const names = await namesFor(ctx.admin, [
    ...writers.map((w) => w.user_id),
    ...eventRows.map((e) => e.by_user as string),
    ...helpRows.flatMap((h) => [h.asked_by as string, h.helper_user_id as string]),
    ...signupRows.map((x) => x.user_id as string),
  ]);
  const name = (id: unknown) => (typeof id === "string" ? (names.get(id) ?? null) : null);

  const answer: Record<string, unknown> = {
    song,
    versions: versions.data ?? [],
    pathwaySteps: pathway.data ?? [],
    events: eventRows.map((e) => ({ ...e, byName: name(e.by_user) })),
    refine: refine.data ?? [],
    writers: withWriterNames(writers, names),
    publishing: publishing.data ?? null,
    checkpoints: checkpoints.data ?? [],
    helpRequests: helpRows.map((h) => {
      const mine = signupRows.filter((x) => x.request_id === h.id);
      return {
        ...h,
        askedByName: name(h.asked_by),
        helperName: name(h.helper_user_id),
        signups: mine.map((x) => ({ ...x, name: name(x.user_id) })),
        viewerSignedUp: mine.some((x) => x.user_id === ctx.viewer.userId),
      };
    }),
    status: status.data ?? null,
    viewerIsWriter: role.isWriter,
    viewerFollowsLead: ((follows.data ?? []) as Row[]).length > 0,
    // Beyond Hub UI's SongDetail:
    shareSteps: share.data ?? [],
    splits: splitsState(writers),
    viewer: {
      isWriter: role.isWriter,
      isLeadWriter: role.isLeadWriter,
      canManage: ctx.viewer.isAdmin || ctx.viewer.canManage,
      canEdit: canEditSong(ctx.viewer, role),
      canDelete: canDeleteSong(ctx.viewer, role),
      canSetPlacement: canSetPlacement(ctx.viewer),
      canTickRefine: canTickProgress(ctx.viewer, role),
      canTickCheckpoints: canTickCheckpoint(ctx.viewer),
      canEditPublishing: canEditPublishing(ctx.viewer, role),
      canReadCelebrate: seeCelebrate,
      canAskForHelp: canAskForHelp(ctx.viewer, role),
      allowedStages: allowedStages(ctx.viewer, role, song.stage, SONG_STAGES),
    },
  };
  // Celebrate notes are only for the song's writers and P&W: absent for everyone else.
  if (seeCelebrate) answer.celebrateNotes = celebrate.data ?? [];
  return NextResponse.json(answer);
}

// ── Create, edit, delete ───────────────────────────────────

export async function createSong(request: Request) {
  const ctx = await openSongLibrary();
  if (!isOpen(ctx)) return ctx.response;
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseSongCreate(b.value, ctx.viewer.userId);
  if (!parsed.ok) return invalid(parsed);

  // 419 sets created_by, the lead writer row, visibility and the first event.
  const ins = await ctx.supabase
    .from(SL_TABLES.songs)
    .insert({ ...parsed.value.song, created_by: ctx.viewer.userId })
    .select(SL_COLUMNS.songs)
    .single();
  if (ins.error) return dbError(ins.error);
  const song = ins.data as SongLibrarySong;

  const warnings: string[] = [];
  for (const w of parsed.value.coWriters) {
    const add = await ctx.supabase.from(SL_TABLES.writers).insert({ song_id: song.id, user_id: w.user_id, display_name: w.display_name, role: w.role });
    if (add.error) {
      console.error("[song-library] co-writer", add.error);
      warnings.push(`Could not add co-writer ${w.display_name ?? w.user_id}`);
    }
  }
  const writers = await ctx.supabase.from(SL_TABLES.writers).select(SL_COLUMNS.writers).eq("song_id", song.id).order("created_at", { ascending: true });
  if (writers.error) return dbError(writers.error);
  const rows = (writers.data ?? []) as SongLibraryWriter[];
  const names = await namesFor(ctx.admin, rows.map((r) => r.user_id));
  return NextResponse.json({ song, writers: withWriterNames(rows, names), splits: splitsState(rows), ...(warnings.length ? { warnings } : {}) }, { status: 201 });
}

export async function patchSong(request: Request, songId: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded.response;
  if (!canEditSong(loaded.ctx.viewer, loaded.role)) return notWriter();
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseSongPatch(b.value, songId);
  if (!parsed.ok) return invalid(parsed);
  if (parsed.value.current_version_id) {
    const v = await loaded.ctx.supabase.from(SL_TABLES.versions).select("id").eq("id", parsed.value.current_version_id).eq("song_id", songId).maybeSingle();
    if (v.error) return dbError(v.error);
    if (!v.data) return badRequest("current_version_id must be a version of this song");
  }
  const up = await loaded.ctx.supabase.from(SL_TABLES.songs).update(parsed.value).eq("id", songId).select(SL_COLUMNS.songs);
  if (up.error) return dbError(up.error);
  const row = ((up.data ?? []) as SongLibrarySong[])[0];
  if (!row) return notWriter();
  return NextResponse.json({ song: row });
}

export async function deleteSong(songId: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded.response;
  if (!canDeleteSong(loaded.ctx.viewer, loaded.role)) return forbidden("Only the song's lead writer can delete it", SL_REASONS.notLead);
  const versions = await loaded.ctx.supabase.from(SL_TABLES.versions).select("storage_path").eq("song_id", songId);
  if (versions.error) return dbError(versions.error);
  const del = await loaded.ctx.supabase.from(SL_TABLES.songs).delete().eq("id", songId).select("id");
  if (del.error) return dbError(del.error);
  if (!((del.data ?? []) as Row[]).length) return forbidden("Only the song's lead writer can delete it", SL_REASONS.notLead);
  const paths = [...((versions.data ?? []) as { storage_path: string }[]).map((v) => v.storage_path), ...(loaded.song.chart_path ? [loaded.song.chart_path] : [])];
  if (paths.length) {
    const rm = await loaded.ctx.admin.storage.from(SONG_LIBRARY_BUCKET).remove(paths);
    if (rm.error) console.error("[song-library] remove files", rm.error);
  }
  return NextResponse.json({ deleted: true });
}

// ── Stage and placement ────────────────────────────────────

/** Put the caller's note on the event 419's trigger just wrote. */
async function noteLatestEvent(loaded: LoadedSong, kind: "stage" | "placement", note: string | null) {
  const ev = await loaded.ctx.supabase
    .from(SL_TABLES.events)
    .select(SL_COLUMNS.events)
    .eq("song_id", loaded.song.id)
    .eq("kind", kind)
    .eq("by_user", loaded.ctx.viewer.userId)
    .order("at", { ascending: false })
    .limit(1);
  if (ev.error) return null;
  const row = ((ev.data ?? []) as Row[])[0] ?? null;
  if (!row || !note) return row;
  const up = await loaded.ctx.supabase.from(SL_TABLES.events).update({ note }).eq("id", row.id).select(SL_COLUMNS.events);
  if (up.error) {
    console.error("[song-library] event note", up.error);
    return row;
  }
  return ((up.data ?? []) as Row[])[0] ?? row;
}

export async function moveStage(request: Request, songId: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded.response;
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseStageMove(b.value);
  if (!parsed.ok) return invalid(parsed);
  const { song, ctx, role } = loaded;
  const { to, from, note } = parsed.value;
  if (from && from !== song.stage) return coded(409, "Someone moved this song first", SL_CODES.moved, { song });
  if (to === song.stage) return NextResponse.json({ song, changed: false });
  if (!canMoveStage(ctx.viewer, role, song.stage, to)) {
    return forbidden(
      role.isWriter
        ? "Writers can move their song between the early stages. A Song Library manager moves it into or out of Demo ready, Share and Celebrate."
        : "Only the song's writers or a Song Library manager can move its stage",
      SL_REASONS.stageNotAllowed
    );
  }
  // Compare-and-set on the stage we checked, so two moves cannot cross.
  const up = await ctx.supabase.from(SL_TABLES.songs).update({ stage: to }).eq("id", song.id).eq("stage", song.stage).select(SL_COLUMNS.songs);
  if (up.error) return dbError(up.error);
  const row = ((up.data ?? []) as SongLibrarySong[])[0];
  if (!row) return coded(409, "Someone moved this song first", SL_CODES.moved);
  const event = await noteLatestEvent(loaded, "stage", note);
  return NextResponse.json({ song: row, changed: true, event });
}

export async function movePlacement(request: Request, songId: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded.response;
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parsePlacementMove(b.value);
  if (!parsed.ok) return invalid(parsed);
  const { song, ctx } = loaded;
  const { to, from, note } = parsed.value;
  if (from && from !== song.placement) return coded(409, "Someone changed the placement first", SL_CODES.moved, { song });
  if (to === song.placement) return NextResponse.json({ song, changed: false });
  if (!canSetPlacement(ctx.viewer)) return forbidden("Only a Song Library manager can change placement", SL_REASONS.placementNotAllowed);
  const up = await ctx.supabase.from(SL_TABLES.songs).update({ placement: to }).eq("id", song.id).eq("placement", song.placement).select(SL_COLUMNS.songs);
  if (up.error) return dbError(up.error);
  const row = ((up.data ?? []) as SongLibrarySong[])[0];
  if (!row) return coded(409, "Someone changed the placement first", SL_CODES.moved);
  const event = await noteLatestEvent(loaded, "placement", note);
  return NextResponse.json({ song: row, changed: true, event });
}

// ── Uploads and versions ───────────────────────────────────

const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  webm: "audio/webm",
  flac: "audio/flac",
};

/**
 * Step 1 of an upload: a signed upload URL for a path we choose. The file
 * goes from the browser straight to the private song-library bucket (the
 * store audio pattern; Vercel's body cap rules out passing it through).
 */
export async function requestUpload(request: Request, songId: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded.response;
  if (!canEditSong(loaded.ctx.viewer, loaded.role)) return notWriter();
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseUploadRequest(b.value);
  if (!parsed.ok) return invalid(parsed);
  const path = `${songId}/${parsed.value.kind === "audio" ? "v" : "chart"}-${randomUUID()}.${parsed.value.ext}`;
  const signed = await loaded.ctx.admin.storage.from(SONG_LIBRARY_BUCKET).createSignedUploadUrl(path, { upsert: false });
  if (signed.error || !signed.data) return serverError(signed.error ?? "no signed upload");
  return NextResponse.json({
    bucket: SONG_LIBRARY_BUCKET,
    path,
    token: signed.data.token,
    signed_url: signed.data.signedUrl,
    content_type: parsed.value.content_type,
    max_bytes: SONG_UPLOAD_MAX_BYTES,
    next: parsed.value.kind === "audio" ? `POST /api/song-library/songs/${songId}/versions { path }` : `PATCH /api/song-library/songs/${songId} { chart_path: path }`,
  });
}

/** Step 2: the upload landed; record the version, then DM subscribers once. */
export async function createVersion(request: Request, songId: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded.response;
  if (!canEditSong(loaded.ctx.viewer, loaded.role)) return notWriter();
  // Audio never passes through a function (Vercel's body cap); see requestUpload.
  if ((request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/")) {
    return coded(415, "Upload the file to the signed URL from POST …/uploads, then send { path } here", SL_CODES.useSignedUpload);
  }
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseVersionCreate(b.value, songId);
  if (!parsed.ok) return invalid(parsed);
  const path = parsed.value.path as string;

  const store = loaded.ctx.admin.storage.from(SONG_LIBRARY_BUCKET);
  const info = await store.info(path);
  const size = info.data ? ((info.data as { size?: number }).size ?? (info.data as { metadata?: { size?: number } }).metadata?.size ?? null) : null;
  if (typeof size !== "number") return coded(400, "The file didn't finish uploading. Upload it again.", SL_CODES.uploadMissing);
  if (size > SONG_UPLOAD_MAX_BYTES) {
    await store.remove([path]);
    return tooLarge();
  }
  const ext = path.split(".").pop() ?? "";
  const ins = await loaded.ctx.supabase
    .from(SL_TABLES.versions)
    .insert({
      song_id: songId,
      storage_path: path,
      label: parsed.value.label ?? null,
      is_demo: parsed.value.is_demo ?? false,
      duration_s: parsed.value.duration_s ?? null,
      mime_type: MIME_BY_EXT[ext] ?? null,
      size_bytes: size,
    })
    .select(SL_COLUMNS.versions)
    .single();
  if (ins.error) return dbError(ins.error);
  const version = ins.data as { id: string; n: number };

  let notified: unknown = null;
  try {
    const run = await runSongUploadDms(loaded.ctx.admin, version.id);
    notified = { outcome: run.outcome, kind: run.kind ?? null, sent: run.results.filter((r) => r.outcome === "sent").length };
  } catch (error) {
    console.error("[song-library-dm]", error);
    notified = { outcome: "error" };
  }
  return NextResponse.json({ version, notified }, { status: 201 });
}

async function versionOf(
  loaded: LoadedSong,
  versionId: string,
): Promise<{ response: NextResponse } | { version: { id: string; storage_path: string } }> {
  if (!isUuid(versionId)) return { response: notFound("Version not found") };
  const v = await loaded.ctx.supabase.from(SL_TABLES.versions).select(SL_COLUMNS.versions).eq("id", versionId).eq("song_id", loaded.song.id).maybeSingle();
  if (v.error) return { response: dbError(v.error) };
  if (!v.data) return { response: notFound("Version not found") };
  return { version: v.data as { id: string; storage_path: string } };
}

export async function patchVersion(request: Request, songId: string, versionId: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded.response;
  if (!canEditSong(loaded.ctx.viewer, loaded.role)) return notWriter();
  const v = await versionOf(loaded, versionId);
  if ("response" in v) return v.response;
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseVersionPatch(b.value);
  if (!parsed.ok) return invalid(parsed);
  const up = await loaded.ctx.supabase.from(SL_TABLES.versions).update(parsed.value).eq("id", versionId).eq("song_id", songId).select(SL_COLUMNS.versions);
  if (up.error) return dbError(up.error);
  return NextResponse.json({ version: ((up.data ?? []) as Row[])[0] ?? null });
}

export async function deleteVersion(songId: string, versionId: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded.response;
  if (!canEditSong(loaded.ctx.viewer, loaded.role)) return notWriter();
  const v = await versionOf(loaded, versionId);
  if ("response" in v) return v.response;
  const del = await loaded.ctx.supabase.from(SL_TABLES.versions).delete().eq("id", versionId).eq("song_id", songId).select("id");
  if (del.error) return dbError(del.error);
  if (!((del.data ?? []) as Row[]).length) return notWriter();
  const rm = await loaded.ctx.admin.storage.from(SONG_LIBRARY_BUCKET).remove([v.version.storage_path]);
  if (rm.error) console.error("[song-library] remove version file", rm.error);
  return NextResponse.json({ deleted: true });
}

/** Any reader: a 10-minute signed URL, signed with the caller's session so 419's storage policy applies. */
export async function versionAudio(songId: string, versionId: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded.response;
  const v = await versionOf(loaded, versionId);
  if ("response" in v) return v.response;
  const signed = await loaded.ctx.supabase.storage.from(SONG_LIBRARY_BUCKET).createSignedUrl(v.version.storage_path, 600);
  if (signed.error || !signed.data) return notFound("The audio file is missing");
  return NextResponse.json({ url: signed.data.signedUrl, expires_in: 600 });
}

/**
 * GET /versions/:vid/audio, Hub UI's versionAudioUrl: a 302 to a 10-minute
 * signed URL, so it works as an <audio src>. The version is read with the
 * caller's session, so only Song Library readers get one.
 */
export async function versionAudioRedirect(versionId: string) {
  const ctx = await openSongLibrary();
  if (!isOpen(ctx)) return ctx.response;
  if (!isUuid(versionId)) return notFound("Version not found");
  const v = await ctx.supabase.from(SL_TABLES.versions).select("id, storage_path").eq("id", versionId).maybeSingle();
  if (v.error) return dbError(v.error);
  if (!v.data) return notFound("Version not found");
  const signed = await ctx.supabase.storage.from(SONG_LIBRARY_BUCKET).createSignedUrl((v.data as { storage_path: string }).storage_path, 600);
  if (signed.error || !signed.data) return notFound("The audio file is missing");
  const res = NextResponse.redirect(signed.data.signedUrl, 302);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
