// The volunteer door: a scan link (https://www.ffsahub.com/scan/<token>)
// opened in the app. The token in the path is the whole credential, so these
// calls carry NO Hub session, even when someone is signed in: the link is the
// authority, never the person's own account.
//
//   GET  /api/scan/[token]?stats=1            door tally (existing, public)
//   GET  /api/scan/[token]?q=name             guest lookup (existing, public)
//   POST /api/scan/[token] {code, scannerName} check in (existing, public)
//   POST /api/scan/[token] {undo}             undo a check-in (existing, public)
//   GET  /api/scan/[token]/event              event title (new, public, this PR)
//
// The four door verbs answer in exactly the staff door's shapes (both routes
// call the website's services/ticket-check-in), so the Tickets schemas are
// reused as they are. Pure: takes a PublicFetch, so tests pass a mock.

import { z } from "zod";

import {
  doorStatsSchema,
  guestsSchema,
  scanOutcomeSchema,
  undoResultSchema,
  type DoorClient,
} from "@/features/tickets/api";
import { ApiError, type ApiFetchInit } from "@/lib/api";

type Init = Pick<ApiFetchInit, "signal">;

// ── Tokens and paths ────────────────────────────────────────────────────────

/** Same alphabet the website mints (hex) plus URL-safe extras; the server rejects anything under 16. */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** The token from a route param, or null when it can't be a scan link. */
export function parseScanToken(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const token = value.trim();
  return TOKEN_RE.test(token) ? token : null;
}

export const scanApiPath = (token: string) => `/api/scan/${encodeURIComponent(token)}`;

/** The website's own page for this link ("Open on the website"). */
export const webScanPath = (token: string) => `/scan/${encodeURIComponent(token)}`;

/**
 * A short, stable name for this link's door: the offline queue's owner and
 * event key. A hash, so the token itself (the credential) is never written
 * to the phone's storage.
 */
export function doorKey(token: string): string {
  // Two FNV-1a passes with different offsets: 64 bits is plenty to keep a
  // phone's few links apart, and far too few to recover a 192-bit token.
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return `link:${fnv(0x811c9dc5)}${fnv(0x01000193)}`;
}

// ── Fetch without a session ─────────────────────────────────────────────────

export type PublicFetch = <T = unknown>(path: string, init?: ApiFetchInit & { schema?: z.ZodType<T> }) => Promise<T>;

export type PublicFetchDeps = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const errorBodySchema = z.object({ error: z.string().max(300) });

// The door route answers these with a sentence written for the volunteer
// ("This scanning link is no longer active…", "Too many requests…"); keep it.
// Anything else gets the app's own words.
const SERVER_WORDS = new Set([400, 404, 409, 410, 429]);

/**
 * Like the app's apiFetch (same errors, timeout and zod parsing) but with no
 * Authorization header and no cookies, and it never signs anyone out: a scan
 * link must work the same for a stranger and for a signed-in staff member.
 * Every failure is an ApiError of kind network, timeout, http or
 * invalid_response, so the Tickets door's retry and queue rules apply as is.
 */
export function createPublicFetch(deps: PublicFetchDeps): PublicFetch {
  const doFetch = deps.fetchImpl ?? fetch;
  return async function publicFetch<T>(path: string, init: ApiFetchInit & { schema?: z.ZodType<T> } = {}): Promise<T> {
    const { schema, timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS, body, ...rest } = init;
    const callerSignal = rest.signal;

    const headers = new Headers(rest.headers);
    headers.set("Accept", "application/json");
    headers.delete("Authorization");
    if (body !== undefined) headers.set("Content-Type", "application/json");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    callerSignal?.addEventListener("abort", () => controller.abort(), { once: true });

    let res: Response;
    try {
      res = await doFetch(`${deps.baseUrl}${path.startsWith("/") ? path : `/${path}`}`, {
        ...rest,
        headers,
        credentials: "omit",
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted && !callerSignal?.aborted) {
        throw new ApiError("timeout", "The server took too long to answer. Try again.");
      }
      if (callerSignal?.aborted) throw err;
      throw new ApiError("network", "Couldn't reach FFSA Hub. Check your connection and try again.");
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text().catch(() => "");
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
        if (res.ok) throw new ApiError("invalid_response", "The server sent a response the app couldn't read.", res.status);
      }
    }

    if (!res.ok) {
      const said = errorBodySchema.safeParse(json);
      const message =
        said.success && SERVER_WORDS.has(res.status)
          ? said.data.error
          : `Something went wrong on the server (${res.status}). Try again.`;
      throw new ApiError("http", message, res.status);
    }

    if (!schema) return json as T;
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError("invalid_response", "The server sent a response the app couldn't read.", res.status);
    }
    return parsed.data;
  };
}

/** The server no longer knows this link (replaced, switched off, expired, or never existed). */
export function isDeadLinkError(err: unknown): boolean {
  return err instanceof ApiError && err.kind === "http" && err.status === 404;
}

// ── The door ────────────────────────────────────────────────────────────────

/**
 * The Tickets DoorClient, authorised by a scan link instead of a session.
 * `scannerName` is the volunteer's first name, recorded with each check-in
 * so the organiser can see who worked the door (the website asks for the
 * same thing).
 */
export function volunteerDoorClient(publicFetch: PublicFetch, token: string, opts: { scannerName?: string | null } = {}): DoorClient {
  const path = scanApiPath(token);
  const scannerName = opts.scannerName?.trim().slice(0, 60) || undefined;
  return {
    stats: (init?: Init) => publicFetch(`${path}?stats=1`, { ...init, schema: doorStatsSchema }),
    search: async (query, init?: Init) =>
      (await publicFetch(`${path}?q=${encodeURIComponent(query)}`, { ...init, schema: guestsSchema })).guests,
    checkIn: (code, init?: Init) =>
      publicFetch(path, { ...init, method: "POST", body: scannerName ? { code, scannerName } : { code }, schema: scanOutcomeSchema }),
    undo: async (ticketId, init?: Init) => {
      await publicFetch(path, { ...init, method: "POST", body: { undo: ticketId }, schema: undoResultSchema });
    },
  };
}

// ── Which event ─────────────────────────────────────────────────────────────

export const scanEventSchema = z.object({
  event: z.object({
    title: z.string(),
    startDate: z.string().nullish().transform((v) => v ?? null),
  }),
});
export type ScanEvent = z.infer<typeof scanEventSchema>["event"];

export async function getScanEvent(publicFetch: PublicFetch, token: string, init?: Init): Promise<ScanEvent> {
  return (await publicFetch(`${scanApiPath(token)}/event`, { ...init, schema: scanEventSchema })).event;
}
