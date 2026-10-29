// ────────────────────────────────────────────────────────────
// getUser() without holding the auth lock
// ────────────────────────────────────────────────────────────
// supabase-js serialises its auth calls behind a per-client lock, and plain
// `auth.getUser()` makes its network request to the Auth server while holding
// it. Every PostgREST query reads the access token through that same lock, so
// any query started alongside getUser() waits a full Auth round trip before it
// can even leave — Promise.all([getUser(), query]) runs one after the other.
//
// This does the same work in two steps: resolve the session first (cookie
// read, plus a token refresh if it has expired — the same thing getUser() does
// internally), then validate that access token with the Auth server via
// getUser(jwt), which does not take the lock. The user returned is still the
// one the Auth server vouches for; nothing here trusts the cookie's copy.
// ────────────────────────────────────────────────────────────

type AuthLike = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSession: () => Promise<{ data: { session: any }; error: unknown }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getUser: (jwt?: string) => Promise<any>;
};

export async function lockFreeGetUser(auth: AuthLike) {
  const { data } = await auth.getSession();
  const token: string | undefined = data?.session?.access_token;
  // No session (or a refresh that failed): let the stock call produce the
  // exact same "no user" result and error it always has.
  if (!token) return auth.getUser();
  return auth.getUser(token);
}
