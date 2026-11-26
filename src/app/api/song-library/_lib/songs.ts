// Songs, stage and placement moves, uploads and versions.
//
//   GET    /api/song-library/songs                       list (?stage ?placement ?writer ?bucket=finished|in_process|needs_demo ?stuck=1 ?q)
//   POST   /api/song-library/songs                       upload a song (caller = lead writer), optional co_writers
//   GET    /api/song-library/songs/:id                   detail
//   PATCH  /api/song-library/songs/:id                   edit (writers)
//   DELETE /api/song-library/songs/:id                   delete (lead writer, admin)
//   POST   /api/song-library/songs/:id/stage             { to, from?, note? }
//   POST   /api/song-library/songs/:id/placement         { to, from?, note? }
//   POST   /api/song-library/songs/:id/uploads           { kind: audio|chart, filename, content_type, size } → signed upload
//   POST   /api/song-library/songs/:id/versions          { path, label?, is_demo?, duration_s? } after the upload landed; DMs subscribers
//   PATCH  /api/song-library/songs/:id/versions/:vid     { label?, is_demo?, isrc? }
//   DELETE /api/song-library/songs/:id/versions/:vid
//   GET    /api/song-library/songs/:id/versions/:vid/audio  short-lived signed read URL
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
  canSetPlacement,
} from "@/lib/song-library/access";
import { badRequest, coded, dbError, forbidden, notFound, serverError } from "@/lib/song-library/http";
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
import { body, isLoaded, isOpen, namesFor, openSong, openSongLibrary, splitsState, withWriterNames, type LoadedSong } from "./shared";

const notWriter = () => forbidden("Only the song's writers can do that", SL_CODES.notWriter);

// ── List and detail ────────────────────────────────────────

export async function listSongs(request: Request) {
  const ctx = await openSongLibrary();
  if (!isOpen(ctx)) return ctx.response;
  const p = new URL(request.url).searchParams;
  const stage = p.get("stage");
  const placement = p.get("placement");
  const writer = p.get("writer");
  const bucket = p.get("bucket");
  if (stage && !isStage(stage)) return badRequest("Unknown stage");
  if (placement && !isPlacement(placement)) return badRequest("Unknown placement");
  if (writer && !isUuid(writer)) return badRequest("writer must be a user id");
  if (bucket && !["finished", "in_process", "needs_demo"].includes(bucket)) return badRequest("bucket must be finished, in_process or needs_demo");

  let query = ctx.supabase.from(SL_TABLES.songs).select(SL_COLUMNS.songs);
  if (stage) query = query.eq("stage", stage);
  if (placement) query = query.eq("placement", placement);
  if (writer) {
    const mine = await ctx.supabase.from(SL_TABLES.writers).select("song_id").eq("user_id", writer);
    if (mine.error) return dbError(mine.error);
    const ids = ((mine.data ?? []) as { song_id: string }[]).map((r) => r.song_id);
    if (!ids.length) return NextResponse.json({ songs: [] });
    query = query.in("id", ids);
  }
  const songs = await query.order("last_activity_at", { ascending: false }).limit(500);
  if (songs.error) return dbError(songs.error);
  let rows = (songs.data ?? []) as SongLibrarySong[];
  const q = p.get("q")?.trim().toLowerCase();
  if (q) rows = rows.filter((s) => s.title.toLowerCase().includes(q));
  if (!rows.length) return NextResponse.json({ songs: [] });

  const ids = rows.map((s) => s.id);
  const [status, writers] = await Promise.all([
    ctx.supabase.from(SL_TABLES.status).select(SL_COLUMNS.status).in("song_id", ids),
    ctx.supabase.from(SL_TABLES.writers).select("id, song_id, user_id, display_name, is_lead").in("song_id", ids),
  ]);
  if (status.error) return dbError(status.error);
  if (writers.error) return dbError(writers.error);
  const statusOf = new Map(((status.data ?? []) as Row[]).map((s) => [s.song_id as string, s]));
  const writerRows = (writers.data ?? []) as Pick<SongLibraryWriter, "id" | "song_id" | "user_id" | "display_name" | "is_lead">[];
  const names = await namesFor(ctx.admin, writerRows.map((w) => w.user_id));

  let out = rows.map((s) => ({
    ...s,
    status: statusOf.get(s.id) ?? null,
    writers: writerRows
      .filter((w) => w.song_id === s.id)
      .map((w) => ({ id: w.id, user_id: w.user_id, is_lead: w.is_lead, name: w.user_id ? (names.get(w.user_id) ?? w.display_name) : w.display_name })),
  }));
  if (bucket === "finished") out = out.filter((s) => s.status?.is_finished === true);
  if (bucket === "needs_demo") out = out.filter((s) => s.status?.needs_demo === true);
  if (bucket === "in_process") out = out.filter((s) => s.status && !s.status.is_finished);
  if (p.get("stuck") === "1") out = out.filter((s) => s.status?.is_stuck === true);
  return NextResponse.json({ songs: out });
}

export async function getSong(songId: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded.response;
  const { ctx, song, writers, role } = loaded;
  const s = ctx.supabase;
  const seeCelebrate = canReadCelebrate(ctx.viewer, role);
  const [status, versions, publishing, checkpoints, events, help, celebrate] = await Promise.all([
    s.from(SL_TABLES.status).select(SL_COLUMNS.status).eq("song_id", song.id).maybeSingle(),
    s.from(SL_TABLES.versions).select(SL_COLUMNS.versions).eq("song_id", song.id).order("n", { ascending: false }),
    s.from(SL_TABLES.publishing).select(SL_COLUMNS.publishing).eq("song_id", song.id).maybeSingle(),
    s.from(SL_TABLES.checkpoints).select("song_id, kind, done_at, by_user, note").eq("song_id", song.id),
    s.from(SL_TABLES.events).select(SL_COLUMNS.events).eq("song_id", song.id).order("at", { ascending: false }).limit(100),
    s.from(SL_TABLES.helpRequests).select(SL_COLUMNS.helpRequests).eq("song_id", song.id).order("created_at", { ascending: false }),
    seeCelebrate
      ? s.from(SL_TABLES.celebrate).select(SL_COLUMNS.celebrate).eq("song_id", song.id).order("prompt_no", { ascending: true })
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const r of [status, versions, publishing, checkpoints, events, help, celebrate]) if (r.error) return dbError(r.error);
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
    status: status.data,
    versions: versions.data ?? [],
    writers: withWriterNames(writers, names),
    splits: splitsState(writers),
    publishing: publishing.data,
    checkpoints: checkpoints.data ?? [],
    events: eventRows.map((e) => ({ ...e, by_name: name(e.by_user) })),
    help_requests: helpRows.map((h) => ({
      ...h,
      asked_by_name: name(h.asked_by),
      helper_name: name(h.helper_user_id),
      signups: signupRows.filter((x) => x.request_id === h.id).map((x) => ({ ...x, name: name(x.user_id) })),
    })),
    my: {
      is_writer: role.isWriter,
      is_lead_writer: role.isLeadWriter,
      can_edit: canEditSong(ctx.viewer, role),
      can_delete: canDeleteSong(ctx.viewer, role),
      can_manage: ctx.viewer.isAdmin || ctx.viewer.canManage,
      can_set_placement: canSetPlacement(ctx.viewer),
      can_edit_publishing: canEditPublishing(ctx.viewer, role),
      can_read_celebrate: seeCelebrate,
      can_ask_for_help: canAskForHelp(ctx.viewer, role),
      allowed_stages: allowedStages(ctx.viewer, role, song.stage, SONG_STAGES),
    },
  };
  // Celebrate notes are only for the song's writers and P&W: absent for everyone else.
  if (seeCelebrate) answer.celebrate_notes = celebrate.data ?? [];
  return NextResponse.json(answer);
}

// ── Create, edit, delete ───────────────────────────────────

export async function createSong(request: Request) {
  const ctx = await openSongLibrary();
  if (!isOpen(ctx)) return ctx.response;
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseSongCreate(b.value, ctx.viewer.userId);
  if (!parsed.ok) return badRequest(parsed.error);

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
  if (!parsed.ok) return badRequest(parsed.error);
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
  if (!canDeleteSong(loaded.ctx.viewer, loaded.role)) return forbidden("Only the song's lead writer can delete it", SL_CODES.notLead);
  const versions = await loaded.ctx.supabase.from(SL_TABLES.versions).select("storage_path").eq("song_id", songId);
  if (versions.error) return dbError(versions.error);
  const del = await loaded.ctx.supabase.from(SL_TABLES.songs).delete().eq("id", songId).select("id");
  if (del.error) return dbError(del.error);
  if (!((del.data ?? []) as Row[]).length) return forbidden("Only the song's lead writer can delete it", SL_CODES.notLead);
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
  if (!parsed.ok) return badRequest(parsed.error);
  const { song, ctx, role } = loaded;
  const { to, from, note } = parsed.value;
  if (from && from !== song.stage) return coded(409, "Someone moved this song first", SL_CODES.moved, { song });
  if (to === song.stage) return NextResponse.json({ song, changed: false });
  if (!canMoveStage(ctx.viewer, role, song.stage, to)) {
    return forbidden(
      role.isWriter
        ? "Writers can move their song between the early stages. A Song Library manager moves it into or out of Demo ready, Share and Celebrate."
        : "Only the song's writers or a Song Library manager can move its stage",
      SL_CODES.stageNotAllowed
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
  if (!parsed.ok) return badRequest(parsed.error);
  const { song, ctx } = loaded;
  const { to, from, note } = parsed.value;
  if (from && from !== song.placement) return coded(409, "Someone changed the placement first", SL_CODES.moved, { song });
  if (to === song.placement) return NextResponse.json({ song, changed: false });
  if (!canSetPlacement(ctx.viewer)) return forbidden("Only a Song Library manager can change placement", SL_CODES.placementNotAllowed);
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
  if (!parsed.ok) return badRequest(parsed.error);
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
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseVersionCreate(b.value, songId);
  if (!parsed.ok) return badRequest(parsed.error);
  const path = parsed.value.path as string;

  const store = loaded.ctx.admin.storage.from(SONG_LIBRARY_BUCKET);
  const info = await store.info(path);
  const size = info.data ? ((info.data as { size?: number }).size ?? (info.data as { metadata?: { size?: number } }).metadata?.size ?? null) : null;
  if (typeof size !== "number") return coded(400, "The file didn't finish uploading. Upload it again.", SL_CODES.uploadMissing);
  if (size > SONG_UPLOAD_MAX_BYTES) {
    await store.remove([path]);
    return badRequest("That file is over 200 MB");
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
  if (!parsed.ok) return badRequest(parsed.error);
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
