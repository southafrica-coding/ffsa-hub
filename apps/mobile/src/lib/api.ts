// Client for the website's API (EXPO_PUBLIC_API_BASE_URL). Used for anything
// with server-side effects or secrets; plain reads can go straight to Supabase
// under RLS. Every call carries the user's Supabase access token as a bearer
// token (web PR "mobile API bearer auth").
//
// Contract with the server:
//   401 {"error":"unauthenticated"} -> sign out locally, back to sign-in
//   403 {"error":"deactivated"}     -> sign out, explain the account is deactivated

import { z } from "zod";

// ── Errors ──────────────────────────────────────────────────────────────────

export type ApiErrorKind =
  | "unauthenticated"
  | "deactivated"
  | "forbidden"
  | "http"
  | "network"
  | "timeout"
  | "invalid_response";

export class ApiError extends Error {
  name = "ApiError";
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export type AuthFailure = "unauthenticated" | "deactivated";

export const DEACTIVATED_MESSAGE = "This account has been deactivated. Contact your administrator.";

// ── Client ──────────────────────────────────────────────────────────────────

export type ApiDeps = {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  onAuthFailure: (reason: AuthFailure) => void | Promise<void>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type ApiFetchInit = Omit<RequestInit, "body"> & {
  body?: unknown;
  timeoutMs?: number;
};

export type ApiFetch = <T = unknown>(
  path: string,
  init?: ApiFetchInit & { schema?: z.ZodType<T> },
) => Promise<T>;

const DEFAULT_TIMEOUT_MS = 15_000;

const errorBodySchema = z.object({ error: z.string() }).partial();

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("invalid_response", "The server sent a response the app couldn't read.", res.status);
  }
}

export function createApiFetch(deps: ApiDeps): ApiFetch {
  const doFetch = deps.fetchImpl ?? fetch;

  return async function apiFetch<T>(
    path: string,
    init: ApiFetchInit & { schema?: z.ZodType<T> } = {},
  ): Promise<T> {
    const { schema, timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS, body, ...rest } = init;

    const callerSignal = rest.signal;
    const token = await deps.getAccessToken();
    // The caller may have given up while we were reading the token.
    if (callerSignal?.aborted) throw callerSignal.reason ?? new Error("Aborted");
    if (!token) {
      await deps.onAuthFailure("unauthenticated");
      throw new ApiError("unauthenticated", "You're signed out.", 401);
    }

    const headers = new Headers(rest.headers);
    headers.set("Accept", "application/json");
    headers.set("Authorization", `Bearer ${token}`);
    if (body !== undefined) headers.set("Content-Type", "application/json");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    callerSignal?.addEventListener("abort", () => controller.abort(), { once: true });

    let res: Response;
    try {
      res = await doFetch(`${deps.baseUrl}${path.startsWith("/") ? path : `/${path}`}`, {
        ...rest,
        headers,
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

    if (res.status === 401) {
      await deps.onAuthFailure("unauthenticated");
      throw new ApiError("unauthenticated", "Your session has ended. Please sign in again.", 401);
    }
    if (res.status === 403) {
      const parsed = errorBodySchema.safeParse(await readJson(res).catch(() => undefined));
      if (parsed.success && parsed.data.error === "deactivated") {
        await deps.onAuthFailure("deactivated");
        throw new ApiError("deactivated", DEACTIVATED_MESSAGE, 403);
      }
      throw new ApiError("forbidden", "You don't have access to this.", 403);
    }
    if (!res.ok) {
      throw new ApiError("http", `Something went wrong on the server (${res.status}). Try again.`, res.status);
    }

    const json = await readJson(res);
    if (!schema) return json as T;
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError("invalid_response", "The server sent a response the app couldn't read.", res.status);
    }
    return parsed.data;
  };
}

// ── GET /api/me ─────────────────────────────────────────────────────────────

// Tolerant on purpose: unknown fields are ignored and optional ones may be
// null or missing, so the server can grow without breaking installed apps.
const nullableString = z.string().nullish().transform((v) => v ?? null);

export const meSchema = z.object({
  user: z.object({ id: z.string(), email: nullableString }),
  profile: z
    .object({
      firstName: nullableString,
      lastName: nullableString,
      preferredName: nullableString,
      avatarUrl: nullableString,
      isActive: z.boolean().nullish().transform((v) => v ?? true),
    })
    .nullish()
    .transform((v) => v ?? null),
  roles: z
    .array(z.object({ name: z.string(), scopeType: nullableString, scopeId: nullableString }))
    .nullish()
    .transform((v) => v ?? []),
  permissions: z
    .array(
      z.object({
        key: z.string(),
        scopeType: nullableString,
        scopeId: nullableString,
        // "direct" | "role" today; kept as a string so a new source can't
        // break parsing.
        source: nullableString,
      }),
    )
    .nullish()
    .transform((v) => v ?? []),
  // Training ties (migration 334): how many students this person walks with
  // and how many schools name them as staff. null when the server could not
  // read them or is older than the app; then only roles/permissions count.
  training: z
    .object({ walkingWith: z.number(), programStaff: z.number() })
    .nullish()
    .transform((v) => v ?? null),
  serverTime: nullableString,
});

export type Me = z.infer<typeof meSchema>;

export function getMe(apiFetch: ApiFetch, init?: Pick<ApiFetchInit, "signal">) {
  return apiFetch("/api/me", { ...init, schema: meSchema });
}

export function displayName(me: Me) {
  const p = me.profile;
  return p?.preferredName || p?.firstName || me.user.email || "there";
}
