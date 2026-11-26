// Writers, splits, sign-off, publishing and celebrate notes.
//
//   POST   /api/song-library/songs/:id/writers                 add a writer (writers)
//   PATCH  /api/song-library/songs/:id/writers/:wid            { display_name?, role?, split_pct? } (writers)
//   DELETE /api/song-library/songs/:id/writers/:wid            (writers; not the lead writer)
//   PUT    /api/song-library/songs/:id/splits                  { splits: [{ writer_id, split_pct }] } every writer, total 100
//   POST   /api/song-library/songs/:id/writers/:wid/confirm    sign off on the current splits
//   DELETE /api/song-library/songs/:id/writers/:wid/confirm    withdraw (once agreed: managers only, revokes)
//   PUT    /api/song-library/songs/:id/publishing              { ccli_no?, publisher?, pro_by_writer?, notes? }
//   GET    /api/song-library/songs/:id/celebrate               writers, managers, admins only
//   PUT    /api/song-library/songs/:id/celebrate/:promptNo     { body } (writers)
//   DELETE /api/song-library/songs/:id/celebrate/:promptNo     (writers)
//
// Splits lock once every writer has signed off on splits that total 100:
// every credit change is then 409 song_splits_locked (419 refuses them too).

import "server-only";

import { NextResponse } from "next/server";
import { isUuid } from "@/lib/departments/validate";
import { canConfirmWriter, canEditPublishing, canEditSong, canReadCelebrate, canWithdrawConfirmation } from "@/lib/song-library/access";
import { badRequest, coded, dbError, forbidden, notFound, splitsLocked } from "@/lib/song-library/http";
import { checkSplits, parseCelebrate, parsePublishing, parseSplits, parseWriterCreate, parseWriterPatch } from "@/lib/song-library/validate";
import { SL_CODES, SL_COLUMNS, SL_TABLES, type Row, type SongLibraryWriter } from "@/lib/song-library/types";
import { body, isLoaded, openSong, splitsState, writersAnswer, type LoadedSong } from "./shared";

const notWriter = () => forbidden("Only the song's writers can change its credits", SL_CODES.notWriter);

/** Writers only, and not while the splits are agreed. */
function creditGate(loaded: LoadedSong) {
  if (!canEditSong(loaded.ctx.viewer, loaded.role)) return notWriter();
  if (splitsState(loaded.writers).agreed) return splitsLocked();
  return null;
}

function writerOf(loaded: LoadedSong, writerId: string): SongLibraryWriter | null {
  return isUuid(writerId) ? (loaded.writers.find((w) => w.id === writerId) ?? null) : null;
}

export async function addWriter(request: Request, songId: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded.response;
  const gate = creditGate(loaded);
  if (gate) return gate;
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseWriterCreate(b.value);
  if (!parsed.ok) return badRequest(parsed.error);
  if (parsed.value.user_id && loaded.writers.some((w) => w.user_id === parsed.value.user_id)) return coded(409, "That person is already a writer on this song", "song_writer_exists");
  if (parsed.value.user_id) {
    const u = await loaded.ctx.admin.from("users").select("id").eq("id", parsed.value.user_id).maybeSingle();
    if (u.error) return dbError(u.error);
    if (!u.data) return badRequest("No Hub user with that id");
  }
  const ins = await loaded.ctx.supabase.from(SL_TABLES.writers).insert({ song_id: songId, ...parsed.value });
  if (ins.error) return dbError(ins.error);
  return writersAnswer(loaded, 201);
}

export async function patchWriter(request: Request, songId: string, writerId: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded.response;
  const writer = writerOf(loaded, writerId);
  if (!writer) return notFound("Writer not found");
  const gate = creditGate(loaded);
  if (gate) return gate;
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseWriterPatch(b.value);
  if (!parsed.ok) return badRequest(parsed.error);
  if ("display_name" in parsed.value && writer.user_id) return badRequest("A writer with a Hub account shows their Hub name");
  const up = await loaded.ctx.supabase.from(SL_TABLES.writers).update(parsed.value).eq("id", writerId).eq("song_id", songId).select("id");
  if (up.error) return dbError(up.error);
  return writersAnswer(loaded);
}

export async function removeWriter(songId: string, writerId: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded.response;
  const writer = writerOf(loaded, writerId);
  if (!writer) return notFound("Writer not found");
  const gate = creditGate(loaded);
  if (gate) return gate;
  if (writer.is_lead) return badRequest("The lead writer stays on the song");
  const del = await loaded.ctx.supabase.from(SL_TABLES.writers).delete().eq("id", writerId).eq("song_id", songId).select("id");
  if (del.error) return dbError(del.error);
  return writersAnswer(loaded);
}

/** Set every writer's split at once. Any change clears all sign-offs (419). */
export async function putSplits(request: Request, songId: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded.response;
  const gate = creditGate(loaded);
  if (gate) return gate;
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseSplits(b.value, loaded.writers.map((w) => w.id));
  if (!parsed.ok) return coded(400, parsed.error, SL_CODES.splitsIncomplete);
  for (const s of parsed.value) {
    const current = loaded.writers.find((w) => w.id === s.writer_id)!;
    if (current.split_pct !== null && Number(current.split_pct) === s.split_pct) continue;
    const up = await loaded.ctx.supabase.from(SL_TABLES.writers).update({ split_pct: s.split_pct }).eq("id", s.writer_id).eq("song_id", songId);
    if (up.error) return dbError(up.error);
  }
  return writersAnswer(loaded);
}

export async function confirmSplit(songId: string, writerId: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded.response;
  const writer = writerOf(loaded, writerId);
  if (!writer) return notFound("Writer not found");
  if (!canConfirmWriter(loaded.ctx.viewer, writer)) {
    return forbidden(
      writer.user_id ? "Only that writer can sign off on their split" : "A Song Library manager signs off for a writer without a Hub account",
      SL_CODES.confirmNotAllowed
    );
  }
  if (writer.confirmed_at) return writersAnswer(loaded);
  const check = checkSplits(loaded.writers);
  if (!check.ok) {
    return coded(400, `Splits must be set for every writer and total 100% before anyone signs off (they total ${check.totalPct}%)`, SL_CODES.splitsIncomplete, {
      total_pct: check.totalPct,
      missing: check.missing,
    });
  }
  const up = await loaded.ctx.supabase
    .from(SL_TABLES.writers)
    .update({ confirmed_at: new Date().toISOString() })
    .eq("id", writerId)
    .eq("song_id", songId)
    .is("confirmed_at", null)
    .select("id");
  if (up.error) return dbError(up.error);
  return writersAnswer(loaded);
}

export async function withdrawSplit(songId: string, writerId: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded.response;
  const writer = writerOf(loaded, writerId);
  if (!writer) return notFound("Writer not found");
  const agreed = splitsState(loaded.writers).agreed;
  if (!canWithdrawConfirmation(loaded.ctx.viewer, writer, agreed)) {
    return agreed ? splitsLocked() : forbidden("Only that writer or a Song Library manager can withdraw this sign-off", SL_CODES.confirmNotAllowed);
  }
  if (!writer.confirmed_at) return writersAnswer(loaded);
  const up = await loaded.ctx.supabase.from(SL_TABLES.writers).update({ confirmed_at: null }).eq("id", writerId).eq("song_id", songId).select("id");
  if (up.error) return dbError(up.error);
  return writersAnswer(loaded);
}

// ── Publishing ─────────────────────────────────────────────

export async function putPublishing(request: Request, songId: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded.response;
  if (!canEditPublishing(loaded.ctx.viewer, loaded.role)) {
    return forbidden("Only the song's writers and the Song Library's leaders can edit publishing", SL_CODES.publishingNotAllowed);
  }
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parsePublishing(b.value, loaded.writers.map((w) => w.id));
  if (!parsed.ok) return badRequest(parsed.error);
  const s = loaded.ctx.supabase;
  const existing = await s.from(SL_TABLES.publishing).select("song_id").eq("song_id", songId).maybeSingle();
  if (existing.error) return dbError(existing.error);
  const write = existing.data
    ? await s.from(SL_TABLES.publishing).update({ ...parsed.value, updated_by: loaded.ctx.viewer.userId }).eq("song_id", songId).select(SL_COLUMNS.publishing)
    : await s.from(SL_TABLES.publishing).insert({ song_id: songId, ...parsed.value, updated_by: loaded.ctx.viewer.userId }).select(SL_COLUMNS.publishing);
  if (write.error) return dbError(write.error);
  return NextResponse.json({ publishing: ((write.data ?? []) as Row[])[0] ?? null });
}

// ── Celebrate notes ────────────────────────────────────────

function promptNo(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

export async function listCelebrate(songId: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded.response;
  if (!canReadCelebrate(loaded.ctx.viewer, loaded.role)) return forbidden("Celebrate notes are private to the song's writers", SL_CODES.notWriter);
  const r = await loaded.ctx.supabase.from(SL_TABLES.celebrate).select(SL_COLUMNS.celebrate).eq("song_id", songId).order("prompt_no", { ascending: true });
  if (r.error) return dbError(r.error);
  return NextResponse.json({ celebrate_notes: r.data ?? [] });
}

export async function putCelebrate(request: Request, songId: string, rawPrompt: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded.response;
  const n = promptNo(rawPrompt);
  if (n === null) return notFound("Prompt not found");
  if (!canEditSong(loaded.ctx.viewer, loaded.role)) return forbidden("Only the song's writers write celebrate notes", SL_CODES.notWriter);
  const b = await body(request);
  if (!b.ok) return b.response;
  const parsed = parseCelebrate(b.value);
  if (!parsed.ok) return badRequest(parsed.error);
  const s = loaded.ctx.supabase;
  const existing = await s.from(SL_TABLES.celebrate).select("prompt_no").eq("song_id", songId).eq("prompt_no", n).maybeSingle();
  if (existing.error) return dbError(existing.error);
  const write = existing.data
    ? await s.from(SL_TABLES.celebrate).update({ body: parsed.value.body, by_user: loaded.ctx.viewer.userId }).eq("song_id", songId).eq("prompt_no", n).select(SL_COLUMNS.celebrate)
    : await s.from(SL_TABLES.celebrate).insert({ song_id: songId, prompt_no: n, body: parsed.value.body, by_user: loaded.ctx.viewer.userId }).select(SL_COLUMNS.celebrate);
  if (write.error) return dbError(write.error);
  return NextResponse.json({ celebrate_note: ((write.data ?? []) as Row[])[0] ?? null });
}

export async function deleteCelebrate(songId: string, rawPrompt: string) {
  const loaded = await openSong(songId);
  if (!isLoaded(loaded)) return loaded.response;
  const n = promptNo(rawPrompt);
  if (n === null) return notFound("Prompt not found");
  if (!canEditSong(loaded.ctx.viewer, loaded.role)) return forbidden("Only the song's writers write celebrate notes", SL_CODES.notWriter);
  const del = await loaded.ctx.supabase.from(SL_TABLES.celebrate).delete().eq("song_id", songId).eq("prompt_no", n);
  if (del.error) return dbError(del.error);
  return NextResponse.json({ deleted: true });
}
