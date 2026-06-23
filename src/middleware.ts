import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const { pathname } = request.nextUrl;

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
    "/apply",
    "/reference",
    "/legal", // public privacy / consent agreement
    "/e", // public ticket storefront (/e/[slug] + /e/[slug]/thanks)
    "/f", // public form runtime (/f/[slug]) — CRM lead-capture forms
    "/join", // public signup link (/join/[code]) — anyone with the active code can self-onboard
    "/preferences", // public email preference / unsubscribe page
    "/api/upload/sign", // public applicants upload photos from /apply
    "/api/public", // public application submission + signup
    "/api/f", // public form submission (/api/f/[slug]/submit)
    "/api/integrations", // payment webhooks (PayFast ITN, future Stripe, etc.) — must be reachable by external services with no auth cookies
    "/api/tickets", // public QR image endpoint (the code in the URL is the auth) — referenced from confirmation emails
    "/api/cron", // Vercel Cron endpoints — authenticated by CRON_SECRET bearer token in the route handler, not session cookies
    "/api/slack", // inbound Slack events (Q&A bot) — authenticated by Slack signing-secret HMAC in the route handler, not session cookies
  ];
  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route));

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

  // Refresh session (important for Server Components)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicRoute && !isOnboarding) {
    // Redirect to login. Skip for public routes — notably /login itself and
    // /auth/* — which are auth-aware (they bypass the fast-path above) but must
    // never redirect-loop back to /login when there's no session.
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    // Redirect authenticated users away from login
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
