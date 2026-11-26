// Song Library client, aimed at the future /api/song-library routes.
// Nothing here ships data: a missing route reads as empty. A 403 is denied, not empty.

import { readOr, requestJson } from "./client";
import type {
  CoWriterInput,
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
  uploads: (id: string) => `${base}/songs/${enc(id)}/uploads`,
  versions: (id: string) => `${base}/songs/${enc(id)}/versions`,
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

  upload: (input: SongLibrarySongInsert & { co_writers: CoWriterInput[] }) =>
    requestJson<{ song: SongLibrarySong }>(songLibraryRoutes.songs, { method: "POST", body: input }),
  moveStage: (id: string, to: SongStage, from: SongStage) =>
    requestJson<{ song: SongLibrarySong }>(songLibraryRoutes.stage(id), { method: "POST", body: { to, from } }),
  movePlacement: (id: string, to: SongPlacement, from: SongPlacement) =>
    requestJson<{ song: SongLibrarySong }>(songLibraryRoutes.placement(id), { method: "POST", body: { to, from } }),
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

/** MIME types the signed-upload API accepts for audio. */
const AUDIO_CONTENT_TYPES: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/flac": "flac",
};

const AUDIO_TYPE_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  webm: "audio/webm",
  flac: "audio/flac",
};

function audioContentType(file: File): string {
  const ct = (file.type || "").toLowerCase();
  if (AUDIO_CONTENT_TYPES[ct]) return ct;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_TYPE_BY_EXT[ext] ?? ct;
}

export type SignedUpload = {
  path: string;
  signed_url: string;
  content_type?: string;
  token?: string;
  bucket?: string;
  max_bytes?: number;
};

/**
 * First audio for a new song: POST /uploads for a signed URL, PUT the file
 * to that URL, then POST /versions with { path }. Multipart to /versions
 * is refused with 415 use_signed_upload.
 */
export async function uploadVersion(songId: string, file: File): Promise<{ ok: true } | { ok: false; code: string | null }> {
  const content_type = audioContentType(file);
  const started = await requestJson<SignedUpload>(songLibraryRoutes.uploads(songId), {
    method: "POST",
    body: { kind: "audio", filename: file.name || "audio", content_type, size: file.size },
  });
  if (!started.ok) return { ok: false, code: started.code };
  const signedUrl = started.data.signed_url;
  const path = started.data.path;
  if (!signedUrl || !path) return { ok: false, code: "invalid_input" };
  try {
    const put = await fetch(signedUrl, {
      method: "PUT",
      headers: { "Content-Type": started.data.content_type || content_type },
      body: file,
    });
    if (!put.ok) return { ok: false, code: "upload_missing" };
  } catch {
    return { ok: false, code: "network" };
  }
  const created = await requestJson<unknown>(songLibraryRoutes.versions(songId), { method: "POST", body: { path } });
  if (!created.ok) return { ok: false, code: created.code };
  return { ok: true };
}

/** Audio is streamed through a checked route; the bucket path is never a URL. */
export function versionAudioUrl(versionId: string): string {
  return `${base}/versions/${enc(versionId)}/audio`;
}

export type SongLibraryApi = typeof songLibraryApi;
