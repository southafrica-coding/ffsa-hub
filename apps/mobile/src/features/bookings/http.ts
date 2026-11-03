// The bookings slice's request helper for the website's API.
//
// Why not the shared apiFetch (src/lib/api.ts)? Two things the bookings
// routes need that it doesn't do:
//   1. The server's own words on a refusal. A clash ("That time is already
//      booked — “Youth Night” has this space…") or a licence problem
//      ("Can't approve — Sam has no licence photo on this booking") comes back
//      as a 400/409 with { error }. apiFetch turns every non-2xx into a
//      generic "Something went wrong (409)", which leaves the person stuck.
//   2. Multipart uploads. Vehicle check photos go to
//      POST /api/vehicles/inspections/upload as FormData, exactly like the
//      website; apiFetch always JSON-encodes the body.
//
// Everything else matches apiFetch on purpose: bearer token, Accept header,
// 15 s timeout, 401 → sign out, 403 {"error":"deactivated"} → sign out with
// the deactivated message, other 403 → "forbidden". Errors are the shared
// ApiError (so the finance helpers that classify errors still apply), with
// the server's message and body attached.

import type { z } from "zod";

import { ApiError, DEACTIVATED_MESSAGE, type ApiDeps } from "@/lib/api";

export type BookingsRequestInit = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** JSON-encoded, unless it's FormData (sent as multipart). */
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type BookingsFetch = <T = unknown>(path: string, init?: BookingsRequestInit & { schema?: z.ZodType<T> }) => Promise<T>;

/** An ApiError that also carries what the server said and sent. */
export class ServerRefusal extends ApiError {
  constructor(
    message: string,
    status: number,
    readonly body: Record<string, unknown>,
  ) {
    super("http", message, status);
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
// Photos on a slow field connection need longer than a JSON call.
export const UPLOAD_TIMEOUT_MS = 90_000;

function isFormData(v: unknown): v is FormData {
  return typeof FormData !== "undefined" && v instanceof FormData;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function createBookingsFetch(deps: ApiDeps): BookingsFetch {
  const doFetch = deps.fetchImpl ?? fetch;

  return async function bookingsFetch<T>(path: string, init: BookingsRequestInit & { schema?: z.ZodType<T> } = {}): Promise<T> {
    const { schema, body, signal: callerSignal, method = body === undefined ? "GET" : "POST" } = init;
    const timeoutMs = init.timeoutMs ?? deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const token = await deps.getAccessToken();
    if (callerSignal?.aborted) throw callerSignal.reason ?? new Error("Aborted");
    if (!token) {
      await deps.onAuthFailure("unauthenticated");
      throw new ApiError("unauthenticated", "You're signed out.", 401);
    }

    const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${token}` };
    let payload: BodyInit | undefined;
    if (isFormData(body)) {
      // No Content-Type: the platform adds the multipart boundary itself.
      payload = body;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    callerSignal?.addEventListener("abort", () => controller.abort(), { once: true });

    let res: Response;
    try {
      res = await doFetch(`${deps.baseUrl}${path.startsWith("/") ? path : `/${path}`}`, {
        method,
        headers,
        body: payload,
        signal: controller.signal,
      });
    } catch (err) {
      if (callerSignal?.aborted) throw err;
      if (controller.signal.aborted) throw new ApiError("timeout", "The server took too long to answer. Try again.");
      throw new ApiError("network", "Couldn't reach FFSA Hub. Check your connection and try again.");
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401) {
      await deps.onAuthFailure("unauthenticated");
      throw new ApiError("unauthenticated", "Your session has ended. Please sign in again.", 401);
    }

    const json = await readBody(res);
    if (res.status === 403) {
      if (asRecord(json).error === "deactivated") {
        await deps.onAuthFailure("deactivated");
        throw new ApiError("deactivated", DEACTIVATED_MESSAGE, 403);
      }
      throw new ApiError("forbidden", "You don't have access to this.", 403);
    }
    if (!res.ok) {
      const rec = asRecord(json);
      const said = typeof rec.error === "string" && rec.error.trim() ? rec.error.trim() : null;
      if (res.status < 500 && said) throw new ServerRefusal(said, res.status, rec);
      throw new ApiError("http", `Something went wrong on the server (${res.status}). Try again.`, res.status);
    }

    if (!schema) return json as T;
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError("invalid_response", "The server sent a response the app couldn't read.", res.status);
    }
    return parsed.data;
  };
}
