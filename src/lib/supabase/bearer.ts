import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// ────────────────────────────────────────────────────────────
// Bearer-token callers (the native phone app)
// ────────────────────────────────────────────────────────────
// The phone app signs in with the same Supabase project as the website, but
// it has no browser cookies. It sends its Supabase access token instead:
//
//   Authorization: Bearer <jwt>
//
// These helpers turn that header into a Supabase client that runs every
// query AS THAT USER: PostgREST checks the token's signature and RLS applies
// exactly as it does for a cookie session. Nothing here uses the service
// role, and nothing trusts the token's own claims; auth.getUser() still asks
// the Auth server.
//
// No next/headers import here on purpose: the middleware (Edge) uses this
// file too.
// ────────────────────────────────────────────────────────────

const BEARER_SCHEME = /^bearer\s+/i;

// header.payload.signature, each base64url. Anything else is not a Supabase
// access token. That matters for /api/cron and /api/slack, which receive
// their OWN secrets as "Bearer …"; those are never sent on to Supabase.
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

// Supabase access tokens are well under this; it stops a huge header being
// forwarded to the Auth server.
const MAX_TOKEN_LENGTH = 8192;

type HeaderSource = Request | Headers | { get(name: string): string | null };

function headerValue(source: HeaderSource): string | null {
  const headers = source instanceof Request ? source.headers : source;
  return headers.get("authorization");
}

/** True if the request carries an `Authorization: Bearer …` header at all, well-formed or not. */
export function hasBearerHeader(source: HeaderSource): boolean {
  return BEARER_SCHEME.test(headerValue(source) ?? "");
}

/**
 * The Supabase access token from `Authorization: Bearer <jwt>`, or null when
 * the header is missing or doesn't hold something shaped like a JWT.
 */
export function getBearerToken(source: HeaderSource): string | null {
  const value = headerValue(source);
  if (!value || !BEARER_SCHEME.test(value)) return null;
  const token = value.replace(BEARER_SCHEME, "").trim();
  if (!token || token.length > MAX_TOKEN_LENGTH || !JWT_SHAPE.test(token)) {
    return null;
  }
  return token;
}

/**
 * A Supabase client that sends `token` on every request, so RLS runs as the
 * token's owner. auth.getUser() with no argument validates that same token
 * with the Auth server, the same way it validates a cookie session.
 * No session is stored or refreshed: the app owns its token's lifecycle.
 */
export function createBearerClient(token: string) {
  const client = createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );

  const getUser = client.auth.getUser.bind(client.auth);
  client.auth.getUser = ((jwt?: string) =>
    getUser(jwt ?? token)) as typeof client.auth.getUser;

  return client;
}

/**
 * A request-scoped client for a route handler that wants the bearer path
 * explicitly. Returns null when the request has no usable bearer token, so
 * a caller can never silently fall back to an anonymous client.
 * Server-only: never import this from a 'use client' component.
 */
export function createClientFromRequest(request: Request) {
  const token = getBearerToken(request);
  return token ? createBearerClient(token) : null;
}
