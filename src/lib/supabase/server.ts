import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import type { Database } from "@/types/database";
import { lockFreeGetUser } from "./get-user";
import { createBearerClient, getBearerToken } from "./bearer";

// One client per server-component render. React's cache() is scoped to a
// single request, so the layout, the profile gate and the page — which each
// call createClient() — share one client instead of building three. In route
// handlers cache() does not memoise (no render in progress), so every call
// still gets a fresh client, exactly as before. Nothing is shared across
// requests or users.
//
// Bearer callers (the phone app): if the request carries
// `Authorization: Bearer <supabase jwt>`, the client runs as that token's
// user instead of the cookie session, and auth.getUser() validates that
// token. This is what lets every existing /api route serve the app without
// being edited. The middleware strips the header from page requests, so it
// only ever takes effect on /api/*; there it has already checked the token and
// the account's is_active flag. With no bearer, this is the cookie client
// exactly as before.
export const createClient = cache(async () => {
  const bearer = getBearerToken(await headers());
  if (bearer) return createBearerClient(bearer) as unknown as CookieClient;

  const cookieStore = await cookies();

  const client = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  );

  // auth.getUser() is called by the layout, the sidebar, the profile gate and
  // nearly every page — each a round trip to Supabase Auth, and each holding
  // the client's auth lock for that round trip, which stalls every query
  // started alongside it. Route it through a per-request memo that still
  // validates the token with the Auth server (once), but without the lock.
  const auth = {
    getSession: client.auth.getSession.bind(client.auth),
    getUser: client.auth.getUser.bind(client.auth),
  };
  client.auth.getUser = ((jwt?: string) =>
    jwt ? auth.getUser(jwt) : getUserForRequest(auth)) as typeof client.auth.getUser;

  return client;
});

type CookieClient = ReturnType<typeof createServerClient<Database>>;

// Keyed on the client's (unpatched) auth methods: inside a render there is one
// shared client, so the Auth server is asked once per request. Outside a
// render (route handlers) cache() is a pass-through and every call goes to
// Auth, as it always has.
const getUserForRequest = cache((auth: Parameters<typeof lockFreeGetUser>[0]) =>
  lockFreeGetUser(auth)
);
