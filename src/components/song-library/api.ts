// Song Library client, aimed at the future /api/song-library routes.
// Nothing here ships data: a missing route reads as empty.

import { readOr, requestJson } from "./client";
import type {
  HelpersPage,
  LibraryHome,
  SongDetail,
  SongHelpCategory,
  SongLibrarySong,
  SongLibrarySongInsert,
  SongListItem,
  SongPlacement,
  SongStage,
  WriterProfile,
} from "./types";

const base = "/api/song-library";
const enc = encodeURIComponent;

export const songLibraryRoutes = {
  home: base,
  songs: `${base}/songs`,
  song: (id: string) => `${base}/songs/${enc(id)}`,
  stage: (id: string) => `${base}/songs/${enc(id)}/stage`,
  placement: (id: string) => `${base}/songs/${enc(id)}/placement`,
  refine: (id: string, q: number) => `${base}/songs/${enc(id)}/refine/${q}`,
  checkpoint: (id: string, kind: string) => `${base}/songs/${enc(id)}/checkpoints/${enc(kind)}`,
  writer: (id: string) => `${base}/writers/${enc(id)}`,
  helpers: `${base}/helpers`,
  helperSignup: (category: SongHelpCategory) => `${base}/helpers/${enc(category)}`,
  canHelp: (requestId: string) => `${base}/help-requests/${enc(requestId)}/signups`,
  helpRequests: (songId: string) => `${base}/songs/${enc(songId)}/help-requests`,
  board: `${base}/board`,
  subscriptions: `${base}/subscriptions`,
} as const;

export const EMPTY_HOME: LibraryHome = { songs: [], subscribedAllUploads: false };
export const EMPTY_HELPERS: HelpersPage = { openRequests: [], categoryCounts: {}, mySignups: [] };

export const songLibraryApi = {
  home: (signal?: AbortSignal) => readOr<LibraryHome>(songLibraryRoutes.home, EMPTY_HOME, signal),
  board: (signal?: AbortSignal) => readOr<SongListItem[]>(songLibraryRoutes.board, [], signal),
  helpers: (signal?: AbortSignal) => readOr<HelpersPage>(songLibraryRoutes.helpers, EMPTY_HELPERS, signal),
  song: (id: string, signal?: AbortSignal) => readOr<SongDetail | null>(songLibraryRoutes.song(id), null, signal),
  writer: (id: string, signal?: AbortSignal) => readOr<WriterProfile | null>(songLibraryRoutes.writer(id), null, signal),

  upload: (input: SongLibrarySongInsert & { co_writers: string[] }) =>
    requestJson<{ song: SongLibrarySong }>(songLibraryRoutes.songs, { method: "POST", body: input }),
  moveStage: (id: string, to: SongStage) =>
    requestJson<{ song: SongLibrarySong }>(songLibraryRoutes.stage(id), { method: "POST", body: { to } }),
  movePlacement: (id: string, to: SongPlacement) =>
    requestJson<{ song: SongLibrarySong }>(songLibraryRoutes.placement(id), { method: "POST", body: { to } }),
  tickRefine: (id: string, q: number, checked: boolean) =>
    requestJson<unknown>(songLibraryRoutes.refine(id, q), { method: "PUT", body: { checked } }),
  subscribeAll: (on: boolean) =>
    requestJson<unknown>(songLibraryRoutes.subscriptions, { method: on ? "POST" : "DELETE", body: { target_type: "all_uploads" } }),
  subscribeWriter: (userId: string, on: boolean) =>
    requestJson<unknown>(songLibraryRoutes.subscriptions, {
      method: on ? "POST" : "DELETE",
      body: { target_type: "writer", target_user_id: userId },
    }),
  helperSignup: (category: SongHelpCategory, on: boolean) =>
    requestJson<unknown>(songLibraryRoutes.helperSignup(category), { method: on ? "PUT" : "DELETE" }),
  canHelp: (requestId: string) => requestJson<unknown>(songLibraryRoutes.canHelp(requestId), { method: "POST", body: {} }),
  askHelp: (songId: string, categories: SongHelpCategory[], body: string) =>
    requestJson<unknown>(songLibraryRoutes.helpRequests(songId), { method: "POST", body: { categories, body } }),
};

/** First audio for a new song. multipart, so it skips the JSON helper. */
export async function uploadVersion(songId: string, file: File): Promise<{ ok: true } | { ok: false; code: string | null }> {
  const form = new FormData();
  form.append("file", file);
  try {
    const response = await fetch(`${base}/songs/${enc(songId)}/versions`, { method: "POST", body: form, credentials: "same-origin" });
    if (response.ok) return { ok: true };
    let code: string | null = null;
    try {
      const body = (await response.json()) as { code?: unknown };
      code = typeof body.code === "string" ? body.code : null;
    } catch {
      code = null;
    }
    return { ok: false, code: code ?? (response.status === 413 ? "too_large" : null) };
  } catch {
    return { ok: false, code: "network" };
  }
}

/** Audio is streamed through a checked route; the bucket path is never a URL. */
export function versionAudioUrl(versionId: string): string {
  return `${base}/versions/${enc(versionId)}/audio`;
}

export type SongLibraryApi = typeof songLibraryApi;
