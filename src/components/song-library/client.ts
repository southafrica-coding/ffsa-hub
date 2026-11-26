// Shared fetch helper for the Song Library and Songwriting UIs.
//
// The backend routes do not exist yet. Reads treat a missing route, a
// network error or bad JSON as "nothing to show", so the pages render
// their empty states. A 403 or code "forbidden" is not an empty catalogue:
// readOr flags `denied` and the page shows a no-access state. Writes
// report a code, never the server's text: only `code` and `fieldErrors`
// keys are read from a reply.

export type ApiFailure = {
  ok: false;
  status: number;
  code: string | null;
  /** Field names the server flagged. Copy comes from the UI, not the server. */
  fields: string[];
};
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

/** Postgres codes we may see without an app code. */
const PG_CODES: Record<string, string> = {
  "42501": "forbidden",
  "23514": "check_failed",
  "23505": "duplicate",
};

function readCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const code = (body as { code?: unknown }).code;
  if (typeof code !== "string" || !code) return null;
  return PG_CODES[code] ?? code;
}

function readFields(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const fe = (body as { fieldErrors?: unknown }).fieldErrors;
  if (!fe || typeof fe !== "object") return [];
  return Object.keys(fe as Record<string, unknown>);
}

export async function requestJson<T>(
  url: string,
  init?: { method?: string; body?: unknown; signal?: AbortSignal }
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init?.method ?? "GET",
      headers: init?.body === undefined ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
      signal: init?.signal,
    });
  } catch {
    return { ok: false, status: 0, code: "network", fields: [] };
  }
  let body: unknown = null;
  try {
    body = response.status === 204 ? null : await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const code = readCode(body) ?? (response.status === 401 ? "unauthenticated" : response.status === 403 ? "forbidden" : response.status === 404 ? "not_found" : response.status === 413 ? "too_large" : response.status === 415 ? "use_signed_upload" : null);
    return { ok: false, status: response.status, code, fields: readFields(body) };
  }
  return { ok: true, data: body as T };
}

export type ReadOrResult<T> = { data: T; missing: boolean; denied: boolean };

function isDenied(result: ApiFailure): boolean {
  return result.status === 403 || result.code === "forbidden" || result.code === "403";
}

/** Read with a fallback: missing routes become the empty value. A 403 is denied, not empty. */
export async function readOr<T>(url: string, empty: T, signal?: AbortSignal): Promise<ReadOrResult<T>> {
  const result = await requestJson<T>(url, { signal });
  if (result.ok) {
    if (result.data == null) return { data: empty, missing: true, denied: false };
    return { data: result.data, missing: false, denied: false };
  }
  return { data: empty, missing: true, denied: isDenied(result) };
}

/** Fixed copy for a failed write. The server's own words are never shown. */
export function errorCopy(code: string | null | undefined): string {
  switch (code) {
    case "unauthenticated":
      return "Sign in again to continue.";
    case "forbidden":
      return "You don't have permission to do that.";
    case "not_found":
      return "That isn't there any more. Refresh and try again.";
    case "invalid_input":
    case "check_failed":
      return "Check the details and try again.";
    case "duplicate":
      return "That already exists.";
    case "splits_not_100":
      return "Splits must add up to 100% before credits can be agreed.";
    case "credits_agreed":
      return "Credits are agreed. Undo the agreement before changing writers or splits.";
    case "stage_not_allowed":
      return "You can't move this song to that stage.";
    case "too_large":
      return "That file is too big. Try a shorter clip or an mp3.";
    case "song_moved":
      return "Someone else moved this song first. We'll refresh it.";
    case "help_closed":
      return "This help request is no longer open.";
    case "upload_missing":
      return "The file didn't finish uploading. Try again.";
    case "use_signed_upload":
      return "This file has to be uploaded to a signed URL. Try again.";
    case "rate_limited":
      return "Too many tries. Wait a minute and try again.";
    case "network":
      return "No connection. Check your internet and try again.";
    default:
      return "That didn't save. Please try again.";
  }
}

/** Friendly copy per form field, for fieldErrors keys. */
export function fieldCopy(field: string): string {
  switch (field) {
    case "title":
      return "Give the song a working title.";
    case "audience_label":
      return "Name the training or group.";
    case "month":
    case "year":
      return "Pick the month.";
    case "split_pct":
      return "Use a split from 0 to 100.";
    case "people_trained":
    case "songs_workshop":
    case "songs_post":
      return "Use a whole number, or leave it blank if unknown.";
    default:
      return "Check this field.";
  }
}
