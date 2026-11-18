import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  createBearerClient,
  getBearerToken,
  hasBearerHeader,
} from "@/lib/supabase/bearer";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname === "/api" || pathname.startsWith("/api/");

  // Sign-out clears its own cookies on the redirect to /login. Do not
  // refresh the session here: getSession() would write the cookies back
  // onto the response, and /login would bounce a still-signed-in user
  // to /dashboard.
  if (pathname === "/auth/sign-out" && request.method === "POST") {
    return NextResponse.next({ request });
  }

  // A bearer token (the phone app) only ever authenticates /api/*. Pages are
  // cookie-only: drop the header before anything downstream can see it, so
  // server components' createClient() never switches to a bearer client.
  if (!isApi && request.headers.has("authorization")) {
    request.headers.delete("authorization");
  }

  let supabaseResponse = NextResponse.next({ request });

  // Public routes that don't require auth
  const publicRoutes = [
    "/login",
    "/forgot-password", // public: request a password-reset link
    "/reset-password", // public: set a new password from a recovery link
    "/api/auth/forgot-password", // public endpoint that issues the reset email
    "/account/confirm-email", // public: confirm an email change from the emailed link
    "/api/account/confirm-email", // public endpoint that applies the email change
    "/api/auth/login-attempt", // public: records failed sign-in attempts (best-effort)
    "/auth/callback",
    "/auth/confirm",
    // public: /setup/[token] — the 30-day onboarding invite lands here with NO
    // session. The invitee has no account yet, which is the whole point, so
    // bouncing them to /login made the invite impossible to complete.
    "/setup",
    "/apply",
    "/reference",
    "/legal", // public privacy / consent agreement
    "/e", // public ticket storefront (/e/[slug] + /e/[slug]/thanks)
    "/f", // public form runtime (/f/[slug]) — CRM lead-capture forms
    "/join", // public signup link (/join/[code]) — anyone with the active code can self-onboard
    "/preferences", // public email preference / unsubscribe page
    "/subscribe", // public sign-up page for labels opened up with public_subscribe (196)
    "/unsubscribe", // public one-click opt-out landing page from email footers
    "/schedule", // public: /schedule/[token] — applicants pick an interview slot
    "/fb", // public event-feedback runtime (/fb/[slug])
    "/scan", // public door scanner (/scan/[token]) — the welcome team has no Hub account, which is the point
    "/serve", // public Missio serving link (/serve/missio/[token]) — the volunteer has no Hub account
    "/vr", // public vehicle request form (/vr/[token]) — shipped in 342 but never listed here, so every outsider was bounced to /login
    "/hire", // public equipment-hire storefront (/hire, /hire/c/[slug], /hire/p/[slug]) — browsing needs no account
    "/t", // public tag landing (/t/[tag]) — the QR on every equipment tag; staff are sent on to the register
    "/track-intent", // public FFX track-intent survey (/track-intent/[token], migration 222) — same gotcha as /vr above
    "/.well-known", // public app-link files (apple-app-site-association, assetlinks.json) — fetched by Apple / Google with no session
    "/api/scan", // public door scanner actions — authorised by the token in the path, not session cookies
    "/api/serve", // public Missio availability — authorised by the hashed token, not session cookies
    "/api/upload/sign", // public applicants upload photos from /apply
    "/api/public", // public application submission + signup
    "/api/f", // public form submission (/api/f/[slug]/submit)
    "/api/fb", // public feedback submission (/api/fb/[slug]/submit)
    "/api/scheduling", // public interview-slot pick — authorised by the magic token
    "/api/preferences", // public email preference save — authorised by the signed prefs token
    "/api/integrations", // payment webhooks (PayFast ITN, future Stripe, etc.) — must be reachable by external services with no auth cookies
    "/api/tickets", // public QR image endpoint (the code in the URL is the auth) — referenced from confirmation emails
    "/api/cron", // Vercel Cron endpoints — authenticated by CRON_SECRET bearer token in the route handler, not session cookies
    "/api/slack", // inbound Slack events (Q&A bot) — authenticated by Slack signing-secret HMAC in the route handler, not session cookies
  ];
  // Match on whole path SEGMENTS, not raw prefixes. A bare startsWith()
  // let "/e" (public ticket storefront) swallow "/events" and "/f"
  // swallow "/finance" — both admin sections — so they skipped the auth
  // redirect below entirely. The admin layout does no auth check of its
  // own, so middleware is the only gate.
  const isPublicRoute = publicRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  // Public ticket checkout — the only public sub-route under
  // /api/events/. Everything else under /api/events/ is admin and
  // still requires auth (the route handlers also enforce roles).
  const isPublicCheckoutRoute = /^\/api\/events\/[^/]+\/checkout\/?$/.test(
    pathname
  );
  // Same exception for the promo-validate preview used by the public storefront.
  const isPublicPromoValidateRoute =
    /^\/api\/events\/[^/]+\/promo\/validate\/?$/.test(pathname);

  // Onboarding requires auth but should not redirect to login if unauthenticated
  // (the page itself handles the redirect)
  const isOnboarding = pathname.startsWith("/onboarding");

  // Fast-path: public routes that don't need ANY auth context can skip the
  // Supabase round-trip entirely (~200-300ms per request). We exclude /login
  // (needs to redirect logged-in users) and /auth/* (callback handlers may
  // need the Supabase client to set session cookies).
  const isAuthAware =
    pathname === "/login" || pathname.startsWith("/auth/");
  if (
    !isAuthAware &&
    (isPublicRoute || isPublicCheckoutRoute || isPublicPromoValidateRoute)
  ) {
    return supabaseResponse;
  }

  // Protected /api/* with `Authorization: Bearer …`: the phone app. The token
  // decides, even if cookies are present too; no cookie work happens.
  if (isApi && hasBearerHeader(request)) {
    return bearerGate(request);
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Check if the account has been deactivated. A PK lookup on every protected
  // request is acceptable — it is a single indexed read and the only way to
  // reliably block a still-valid Supabase session. Skip this check on public
  // routes (already bypassed above) to keep them fast.
  const readIsActive = async (id: string) => {
    const { data } = await supabase
      .from("users")
      .select("is_active")
      .eq("id", id)
      .single();
    return data as { is_active: boolean | null } | null;
  };

  // Refresh session (important for Server Components). getSession() reads the
  // cookie and refreshes an expired token — the same first step getUser()
  // takes — so the token can then be validated with the Auth server while
  // the is_active lookup runs alongside it, rather than one after the other.
  // getUser(token) still has the Auth server vouch for the user; the token's
  // own claim is only used to start the lookup early, and is thrown away
  // unless it matches the validated user.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  const claimedUserId = accessToken ? jwtSubject(accessToken) : null;

  const [
    {
      data: { user },
    },
    claimedRow,
  ] = await Promise.all([
    accessToken ? supabase.auth.getUser(accessToken) : supabase.auth.getUser(),
    claimedUserId ? readIsActive(claimedUserId) : Promise.resolve(null),
  ]);

  let isDeactivated = false;
  if (user) {
    const userRow =
      user.id === claimedUserId ? claimedRow : await readIsActive(user.id);
    isDeactivated = userRow?.is_active === false;
  }

  // Deactivated accounts may only visit /login (so they can see the error and
  // their session can be cleared client-side). Every other protected route
  // redirects them back there. This check must come BEFORE the "authenticated
  // users leave /login" block below to avoid a redirect loop.
  if (isDeactivated && !isPublicRoute && pathname !== "/login") {
    if (isApi && !wantsHtml(request)) return apiDeactivated();
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "deactivated");
    url.searchParams.delete("redirect");
    return NextResponse.redirect(url);
  }

  if (!user && !isPublicRoute && !isOnboarding) {
    // API calls (fetch, the phone app) get a 401 they can act on, not a 307
    // to an HTML login page. A browser NAVIGATION to /api/* (an export link,
    // "Connect Xero") asks for text/html and still goes to /login below.
    if (isApi && !wantsHtml(request)) {
      return apiUnauthenticated("Sign in to use this endpoint.");
    }
    // Redirect to login. Skip for public routes — notably /login itself and
    // /auth/* — which are auth-aware (they bypass the fast-path above) but must
    // never redirect-loop back to /login when there's no session.
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  if (user && !isDeactivated && pathname === "/login") {
    // A failed sign-out often leaves the session cookie in place. Let that
    // one URL through so the login page can show the error instead of
    // bouncing straight back to the dashboard.
    if (request.nextUrl.searchParams.get("error") === "signout") {
      return supabaseResponse;
    }
    // Redirect authenticated (active) users away from login
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

// ────────────────────────────────────────────────────────────
// Bearer path (protected /api/* only)
// ────────────────────────────────────────────────────────────
// Same two checks as the cookie path, against the token instead of the
// cookie: the Auth server must vouch for the token, and the account must not
// be deactivated. is_active is read with a client carrying that same bearer,
// so RLS ("users can read own user record") applies; never the service role.
// The token's own `sub` is only used to start that read early, as above.
async function bearerGate(request: NextRequest) {
  const token = getBearerToken(request);
  if (!token) {
    return apiUnauthenticated("The access token is missing or malformed.");
  }

  const supabase = createBearerClient(token);
  const readIsActive = async (id: string) => {
    const { data } = await supabase
      .from("users")
      .select("is_active")
      .eq("id", id)
      .single();
    return data as { is_active: boolean | null } | null;
  };

  const claimedUserId = jwtSubject(token);
  const [
    {
      data: { user },
    },
    claimedRow,
  ] = await Promise.all([
    supabase.auth.getUser(token),
    claimedUserId ? readIsActive(claimedUserId) : Promise.resolve(null),
  ]);

  if (!user) {
    return apiUnauthenticated("The access token is invalid or has expired.");
  }
  const userRow =
    user.id === claimedUserId ? claimedRow : await readIsActive(user.id);
  if (userRow?.is_active === false) return apiDeactivated();

  // The Authorization header is forwarded untouched, so the route's
  // createClient() runs as this user.
  return NextResponse.next({ request });
}

// Both bodies are part of the phone app's contract; keep the `error` codes.
function apiUnauthenticated(message: string) {
  return NextResponse.json(
    { error: "unauthenticated", message },
    { status: 401, headers: { "Cache-Control": "no-store" } }
  );
}

function apiDeactivated() {
  return NextResponse.json(
    {
      error: "deactivated",
      message: "This account has been deactivated. Contact an administrator.",
    },
    { status: 403, headers: { "Cache-Control": "no-store" } }
  );
}

// A browser navigation (address bar, <a href>, window.open) sends
// Accept: text/html; fetch() sends */* unless told otherwise.
function wantsHtml(request: NextRequest): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}

// The `sub` claim of a JWT, unverified. Only ever used as a hint to start a
// query early — see above; the Auth server's answer is what's trusted.
function jwtSubject(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const sub = JSON.parse(atob(padded))?.sub;
    return typeof sub === "string" && sub ? sub : null;
  } catch {
    return null;
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
