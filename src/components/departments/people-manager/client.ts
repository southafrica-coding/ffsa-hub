// Fetch helper and fixed copy for the People Manager UI, after
// components/song-library/client.ts. Only a reply's `code` is read on a
// failure: the server's `error` text (and sent_to[].error) is never shown.

import type {
  PmAway,
  PmBlockout,
  PmCreateBody,
  PmDecision,
  PmDecisionBody,
  PmOverview,
  PmPreview,
  PmRequest,
  PmRequestDetail,
  PmRequestList,
  PmUsageResponse,
} from "./types";

export type ApiFailure = { ok: false; status: number; code: string | null };
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

function statusCode(status: number): string | null {
  switch (status) {
    case 400:
      return "invalid_input";
    case 401:
      return "unauthenticated";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    default:
      return null;
  }
}

export async function requestJson<T>(
  url: string,
  init?: { method?: string; body?: unknown; signal?: AbortSignal }
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init?.method ?? "GET",
      headers:
        init?.body === undefined
          ? { accept: "application/json" }
          : { "content-type": "application/json", accept: "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
      signal: init?.signal,
    });
  } catch {
    return { ok: false, status: 0, code: "network" };
  }
  let body: unknown = null;
  try {
    body = response.status === 204 ? null : await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) return { ok: false, status: response.status, code: readCode(body) ?? statusCode(response.status) };
  return { ok: true, data: body as T };
}

export type ReadOrResult<T> = { data: T; missing: boolean; denied: boolean };

/** Read with a fallback. A 401/403 is denied, not empty. */
export async function readOr<T>(url: string, empty: T, signal?: AbortSignal): Promise<ReadOrResult<T>> {
  const result = await requestJson<T>(url, { signal });
  if (result.ok) return result.data == null ? { data: empty, missing: true, denied: false } : { data: result.data, missing: false, denied: false };
  return { data: empty, missing: true, denied: isDenied(result) };
}

export function isDenied(result: Pick<ApiFailure, "status" | "code">): boolean {
  return result.status === 401 || result.status === 403 || result.code === "forbidden" || result.code === "unauthenticated";
}

export const ALREADY_DECIDED = "leave_request_already_decided";

/** Fixed copy for a failure, by code only. The server's words are never shown. */
export function errorCopy(code: string | null | undefined): string {
  switch (code) {
    case "unauthenticated":
    case "leave_request_not_signed_in":
      return "Sign in again to continue.";
    case "forbidden":
    case "leave_request_server_only":
      return "You don't have permission to do that.";
    case "not_found":
      return "That isn't there any more. Refresh and try again.";
    case "network":
      return "No connection. Check your internet and try again.";
    case "invalid_input":
    case "check_failed":
      return "Check the details and try again.";
    case "duplicate":
    case "conflict":
      return "That changed in the meantime. Refresh and try again.";
    case ALREADY_DECIDED:
      return "Someone else decided this request first. Here's where it stands now.";
    case "leave_request_decline_note_required":
      return "Add a note to say why before you decline.";
    case "leave_request_no_working_days":
      return "Those dates have no weekdays to take off. Weekends and public holidays aren't counted as leave.";
    case "leave_request_not_approver":
      return "Only another leader of this department, or an admin, can decide this request.";
    case "leave_request_self_decision":
      return "You can't decide your own request.";
    case "leave_request_not_member":
    case "leave_request_not_requester":
      return "Only members of this department can ask for time off here.";
    case "leave_request_type_not_available":
      return "That type of leave isn't offered here any more. Pick another.";
    case "leave_request_bad_range":
    case "leave_days_bad_range":
      return "Those dates don't fit together. Check the first and last day.";
    case "leave_request_locked":
      return "This request can't change any more.";
    case "leave_request_changed":
      return "This request changed in the meantime. We've refreshed it.";
    case "leave_request_cancel_not_allowed":
      return "Only the person who asked can cancel this request.";
    case "leave_request_immutable":
    case "leave_request_must_start_pending":
      return "A sent request can't be edited. Cancel it and send a new one.";
    case "leave_blockout_immutable":
      return "That block-out can't be moved to someone else.";
    default:
      return "That didn't work. Please try again.";
  }
}

/**
 * The body for POST /requests/:id/decision. Always `declined`, never
 * `denied`. A decline without a note is refused here (null), before any
 * request is sent; an approve note is optional.
 */
export function decisionBody(decision: PmDecision, note?: string | null): PmDecisionBody | null {
  const text = (note ?? "").trim();
  if (decision === "declined") return text ? { decision: "declined", note: text } : null;
  return text ? { decision: "approved", note: text } : { decision: "approved" };
}

// ── API ────────────────────────────────────────────────────

export function pmApiBase(slug: string): string {
  return `/api/departments/${encodeURIComponent(slug)}/people-manager`;
}

function qs(params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function pmUrls(slug: string) {
  const base = pmApiBase(slug);
  return {
    overview: (year?: number) => `${base}${qs({ year })}`,
    preview: () => `${base}/preview`,
    requests: (p: { scope: "mine" | "department" | "pending"; year?: number | null; person?: string | null; status?: string | null }) =>
      `${base}/requests${qs(p)}`,
    request: (id: string) => `${base}/requests/${encodeURIComponent(id)}`,
    usage: (p: { year?: number; person?: string | null } = {}) => `${base}/usage${qs(p)}`,
    away: (from: string, to: string) => `${base}/away${qs({ from, to })}`,
    blockouts: (p: { person?: string | null; from?: string | null; to?: string | null } = {}) => `${base}/blockouts${qs(p)}`,
    blockout: (id: string) => `${base}/blockouts/${encodeURIComponent(id)}`,
  };
}

export function pmApi(slug: string) {
  const u = pmUrls(slug);
  return {
    urls: u,
    overview: (year?: number) => requestJson<PmOverview>(u.overview(year)),
    preview: (body: Partial<PmCreateBody> & { start_date: string; end_date: string }, signal?: AbortSignal) =>
      requestJson<PmPreview>(u.preview(), { method: "POST", body, signal }),
    list: (p: Parameters<typeof u.requests>[0]) => requestJson<PmRequestList>(u.requests(p)),
    get: (id: string) => requestJson<PmRequestDetail>(u.request(id)),
    create: (body: PmCreateBody) =>
      requestJson<{ success: true; request: PmRequest }>(`${pmApiBase(slug)}/requests`, { method: "POST", body }),
    decide: (id: string, body: PmDecisionBody) =>
      requestJson<{ success: true; request: PmRequest }>(`${u.request(id)}/decision`, { method: "POST", body }),
    cancel: (id: string) => requestJson<{ success: true; request: PmRequest }>(`${u.request(id)}/cancel`, { method: "POST", body: {} }),
    notify: (id: string) => requestJson<{ success: true }>(`${u.request(id)}/notify`, { method: "POST", body: {} }),
    usage: (p?: { year?: number; person?: string | null }) => requestJson<PmUsageResponse>(u.usage(p)),
    away: (from: string, to: string) => requestJson<PmAway>(u.away(from, to)),
    blockouts: (p?: { person?: string | null; from?: string | null; to?: string | null }) =>
      requestJson<{ blockouts: PmBlockout[] }>(u.blockouts(p)),
    createBlockout: (body: { start_date: string; end_date: string; reason: string | null }) =>
      requestJson<{ success: true; blockout: PmBlockout }>(u.blockouts(), { method: "POST", body }),
    updateBlockout: (id: string, body: { start_date: string; end_date: string; reason: string | null }) =>
      requestJson<{ success: true; blockout: PmBlockout }>(u.blockout(id), { method: "PATCH", body }),
    deleteBlockout: (id: string) => requestJson<{ success: true }>(u.blockout(id), { method: "DELETE" }),
  };
}

export type PmApi = ReturnType<typeof pmApi>;

// ── pages ──────────────────────────────────────────────────

export function pmPaths(slug: string) {
  const dept = `/departments/${encodeURIComponent(slug)}`;
  const base = `${dept}/people-manager`;
  return {
    roster: `${dept}?tab=people`,
    department: dept,
    home: base,
    request: `${base}/request`,
    mine: `${base}/mine`,
    blockouts: `${base}/blockouts`,
    settings: `${base}/settings`,
    dmPreview: `${base}/dm-preview`,
    person: (userId: string) => `${base}/people/${encodeURIComponent(userId)}`,
    requestPage: (id: string) => `${base}/requests/${encodeURIComponent(id)}`,
    mineFocus: (id: string) => `${base}/mine?request=${encodeURIComponent(id)}`,
    homeFocus: (id: string) => `${base}?request=${encodeURIComponent(id)}`,
  };
}
