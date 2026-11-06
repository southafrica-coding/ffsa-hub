// Thin browser client for the evangelism routes opened in PR #499.
// Those routes are not on main yet. A 404 or 503 is the "not switched on"
// state — the screens render it, they do not invent data.

import {
  MEDIA_SIGN_PATH,
  TESTIMONIES_PATH,
  feedUrl,
  testimoniesUrl,
  type FieldError,
  type StoryWrite,
  type Testimony,
} from "./logic";

export type EvangelismStats = {
  range: string;
  from: string;
  to: string;
  timezone: string;
  published_count: number;
  people_reached: number;
  decisions: number;
  by_outcome: Record<string, number>;
  by_location: Array<{
    location_label: string;
    testimonies: number;
    people_reached: number;
    decisions: number;
  }>;
  latest_published_at: string | null;
  truncated: boolean;
};

export type FeedPayload = {
  transport: "poll";
  poll_after_seconds: number;
  server_time: string;
  cursor: string | null;
  testimonies: Testimony[];
  /** Stories already on screen, with new read URLs. Present when `visible` was sent. */
  refreshed?: Testimony[];
  /** Withheld, deleted, or no longer published. Apply after appending. */
  removed_ids?: string[];
  media_expires_at?: string | null;
  stats: EvangelismStats;
  can_publish?: boolean;
};

export type SignPayload = {
  bucket: string;
  path: string;
  signed_url: string;
  token: string;
  content_type: string;
  max_bytes: number;
};

export type ApiFailure = {
  ok: false;
  status: number;
  error: string;
  message: string;
  fields?: FieldError[];
};

export type ApiSuccess<T> = { ok: true; status: number; data: T };

const OFFLINE =
  "Evangelism testimonies are not switched on yet. Hub Data still has to apply the tables and the evangelism-media bucket.";

export function isOffline(failure: ApiFailure): boolean {
  return (
    failure.status === 404 ||
    failure.status === 503 ||
    failure.error === "evangelism_not_enabled" ||
    failure.error === "not_found_route"
  );
}

async function parse<T>(res: Response): Promise<ApiSuccess<T> | ApiFailure> {
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown;
      body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const error = typeof body?.error === "string" ? body.error : res.status === 404 ? "not_found_route" : "server_error";
    const message =
      typeof body?.message === "string"
        ? body.message
        : res.status === 404
          ? OFFLINE
          : "Something went wrong. Try again.";
    const fields = Array.isArray(body?.fields)
      ? body.fields.filter(
          (item): item is FieldError =>
            !!item &&
            typeof item === "object" &&
            typeof (item as FieldError).field === "string" &&
            typeof (item as FieldError).message === "string"
        )
      : undefined;
    return { ok: false, status: res.status, error, message, fields };
  }

  return { ok: true, status: res.status, data: (body ?? {}) as T };
}

async function send<T>(url: string, init?: RequestInit): Promise<ApiSuccess<T> | ApiFailure> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      cache: "no-store",
    });
    return parse<T>(res);
  } catch {
    return {
      ok: false,
      status: 0,
      error: "network",
      message: "The Hub didn't answer. Check your connection and try again.",
    };
  }
}

export function listTestimonies(query: { status?: string; mine?: boolean; limit?: number }) {
  return send<{ testimonies: Testimony[] }>(testimoniesUrl(query));
}

export function createTestimony(body: StoryWrite) {
  return send<{ testimony: Testimony }>(TESTIMONIES_PATH, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateTestimony(id: string, body: Partial<StoryWrite> & { confirm_consent?: boolean }) {
  return send<{ testimony: Testimony }>(`${TESTIMONIES_PATH}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteTestimony(id: string) {
  return send<{ ok: boolean }>(`${TESTIMONIES_PATH}/${id}`, { method: "DELETE" });
}

export function getFeed(since: string | null, visibleIds?: string[]) {
  return send<FeedPayload>(feedUrl(since, visibleIds));
}

export function signMedia(body: { kind: "photo" | "video"; content_type: string; size: number }) {
  return send<SignPayload>(MEDIA_SIGN_PATH, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * PUT the file to the signed upload URL from POST /api/evangelism/media/sign.
 * Matches supabase-js uploadToSignedUrl: multipart body, x-upsert false.
 * A raw body with Content-Type is rejected by that endpoint.
 */
export async function putSignedUpload(
  target: { signed_url: string; token?: string },
  file: File,
  contentType: string
): Promise<ApiFailure | { ok: true }> {
  let url: string;
  try {
    const signed = new URL(target.signed_url);
    if (target.token && !signed.searchParams.get("token")) signed.searchParams.set("token", target.token);
    url = signed.toString();
  } catch {
    return { ok: false, status: 0, error: "bad_request", message: "The upload link was not usable." };
  }

  const typed = file.type === contentType ? file : new File([file], file.name, { type: contentType });
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", typed);

  try {
    const res = await fetch(url, {
      method: "PUT",
      body,
      headers: { "x-upsert": "false" },
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: "upload_failed",
        message: "One of the files didn't upload. Try it again.",
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      status: 0,
      error: "network",
      message: "One of the files didn't upload. Check your connection and try again.",
    };
  }
}
