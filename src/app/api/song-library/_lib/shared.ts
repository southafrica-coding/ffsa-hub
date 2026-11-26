// Shared bits for the Song Library handlers: opening the library, loading
// one song with the caller's role on it, display names and splits state.

import "server-only";

import { NextResponse } from "next/server";
import { readJson } from "@/lib/departments/http";
import { isUuid } from "@/lib/departments/validate";
import type { SongRole } from "@/lib/song-library/access";
import { isOpen, openSongLibrary, type SongLibraryContext } from "./context";
import { badRequest, dbError, notFound } from "@/lib/song-library/http";
import { checkSplits } from "@/lib/song-library/validate";
import { SL_COLUMNS, SL_TABLES, type Client, type Row, type SongLibrarySong, type SongLibraryWriter } from "@/lib/song-library/types";

export type Opened = { response: NextResponse } | SongLibraryContext;
export { isOpen, openSongLibrary };

export type LoadedSong = {
  ctx: SongLibraryContext;
  song: SongLibrarySong;
  writers: SongLibraryWriter[];
  role: SongRole;
};

/** The song (any reader sees it) and the caller's role on it. 404 when it is not there. */
export async function openSong(songId: string): Promise<{ response: NextResponse } | LoadedSong> {
  const ctx = await openSongLibrary();
  if (!isOpen(ctx)) return ctx;
  if (!isUuid(songId)) return { response: notFound("Song not found") };
  const [song, writers] = await Promise.all([
    ctx.supabase.from(SL_TABLES.songs).select(SL_COLUMNS.songs).eq("id", songId).maybeSingle(),
    ctx.supabase.from(SL_TABLES.writers).select(SL_COLUMNS.writers).eq("song_id", songId).order("created_at", { ascending: true }),
  ]);
  if (song.error) return { response: dbError(song.error) };
  if (writers.error) return { response: dbError(writers.error) };
  if (!song.data) return { response: notFound("Song not found") };
  const rows = (writers.data ?? []) as SongLibraryWriter[];
  const mine = rows.find((w) => w.user_id === ctx.viewer.userId);
  return {
    ctx,
    song: song.data as SongLibrarySong,
    writers: rows,
    role: { isWriter: !!mine, isLeadWriter: !!mine?.is_lead },
  };
}

export function isLoaded(r: { response: NextResponse } | LoadedSong): r is LoadedSong {
  return !("response" in r);
}

export async function body(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  const r = await readJson(request);
  return r.ok ? r : { ok: false, response: badRequest("Send a JSON body") };
}

export type SplitsState = {
  total_pct: number;
  complete: boolean;
  writers: number;
  confirmed: number;
  /** Every writer signed off on complete splits: locked. */
  agreed: boolean;
};

/** Same rule as 419's song_library_splits_agreed. */
export function splitsState(writers: readonly Pick<SongLibraryWriter, "id" | "split_pct" | "confirmed_at">[]): SplitsState {
  const check = checkSplits(writers);
  const confirmed = writers.filter((w) => w.confirmed_at).length;
  return {
    total_pct: check.totalPct,
    complete: check.ok,
    writers: writers.length,
    confirmed,
    agreed: check.ok && confirmed === writers.length,
  };
}

export type Person = { id: string; name: string };

/**
 * Display names for people on songs. Service role, after the caller passed
 * the Song Library gate: the library is base-wide, so writers' and
 * helpers' names are shown to every reader. Only name columns are read.
 */
export async function namesFor(admin: Client, ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const r = await admin.from("users").select(SL_COLUMNS.people).in("id", unique);
  if (r.error) {
    console.error("[song-library] names", r.error);
    return new Map();
  }
  return new Map(
    ((r.data ?? []) as Row[]).map((u) => [
      u.id as string,
      [u.preferred_name || u.first_name, u.last_name].filter(Boolean).join(" ") || "Hub user",
    ])
  );
}

/** A writer's shown name: their Hub name, else the name typed in for them. */
export function writerName(w: Pick<SongLibraryWriter, "user_id" | "display_name">, names: Map<string, string>): string {
  return (w.user_id ? names.get(w.user_id) : null) ?? w.display_name ?? "Writer";
}

/** Lead writer first, then in the order they were added. */
export function leadFirst<T extends { is_lead: boolean }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => Number(b.is_lead) - Number(a.is_lead));
}

/** Writer rows with `name` (always a string, as Hub UI's SongDetail expects) and numeric split_pct. */
export function withWriterNames(writers: readonly SongLibraryWriter[], names: Map<string, string>) {
  return leadFirst(writers).map((w) => ({ ...w, split_pct: w.split_pct === null ? null : Number(w.split_pct), name: writerName(w, names) }));
}

/** Hub UI's SongPerson. Never an email or phone. */
export type SongPerson = { userId: string | null; name: string };

/** Hub UI's SongListItem: one row on the library list, writer page and board. */
export type SongListItem = { song: SongLibrarySong; writers: SongPerson[]; status: Row | null };

/** List items for some songs: writers (lead first) and the status view row. */
export async function listItems(ctx: SongLibraryContext, songs: readonly SongLibrarySong[]): Promise<{ ok: true; items: SongListItem[] } | { ok: false; response: NextResponse }> {
  if (!songs.length) return { ok: true, items: [] };
  const ids = songs.map((s) => s.id);
  const [status, writers] = await Promise.all([
    ctx.supabase.from(SL_TABLES.status).select(SL_COLUMNS.status).in("song_id", ids),
    ctx.supabase.from(SL_TABLES.writers).select("id, song_id, user_id, display_name, is_lead, created_at").in("song_id", ids).order("created_at", { ascending: true }),
  ]);
  if (status.error) return { ok: false, response: dbError(status.error) };
  if (writers.error) return { ok: false, response: dbError(writers.error) };
  const statusOf = new Map(((status.data ?? []) as Row[]).map((s) => [s.song_id as string, s]));
  const writerRows = (writers.data ?? []) as Pick<SongLibraryWriter, "id" | "song_id" | "user_id" | "display_name" | "is_lead">[];
  const names = await namesFor(ctx.admin, writerRows.map((w) => w.user_id));
  return {
    ok: true,
    items: songs.map((song) => ({
      song,
      writers: leadFirst(writerRows.filter((w) => w.song_id === song.id)).map((w) => ({ userId: w.user_id, name: writerName(w, names) })),
      status: statusOf.get(song.id) ?? null,
    })),
  };
}

/** Re-read a song's writers (after a change) and answer with them and the splits state. */
export async function writersAnswer(loaded: LoadedSong, status = 200) {
  const w = await loaded.ctx.supabase.from(SL_TABLES.writers).select(SL_COLUMNS.writers).eq("song_id", loaded.song.id).order("created_at", { ascending: true });
  if (w.error) return dbError(w.error);
  const rows = (w.data ?? []) as SongLibraryWriter[];
  const names = await namesFor(loaded.ctx.admin, rows.map((r) => r.user_id));
  return NextResponse.json({ writers: withWriterNames(rows, names), splits: splitsState(rows) }, { status });
}
