import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Sign-out has to clear the cookies on the response that sends the browser
// to /login. The sidebar used to call the browser client and then
// router.push("/login"). Middleware still saw the session (it sends every
// signed-in visit to /login straight back to /dashboard), so the click
// showed the admin loading state and landed on the dashboard again.
//
// A form POST to this route is a full navigation. signOut writes the
// cleared cookies onto the redirect itself. If the global revoke fails,
// the cookies usually survive: clear them locally and blank every sb-*
// auth cookie on the redirect, then send the browser to
// /login?error=signout. Middleware lets that URL through even when a
// session is still present, so the message can actually render.

type CookieToSet = { name: string; value: string; options?: Parameters<NextResponse["cookies"]["set"]>[2] };

export async function POST(request: NextRequest) {
  const cleared: CookieToSet[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cleared.push(...cookiesToSet);
        },
      },
    }
  );

  const { error } = await supabase.auth.signOut();
  if (error) {
    // Global revoke failed. Drop the local session anyway.
    await supabase.auth.signOut({ scope: "local" });
  }

  const url = new URL("/login", request.url);
  if (error) url.searchParams.set("error", "signout");
  const response = NextResponse.redirect(url, { status: 303 });
  for (const cookie of cleared) {
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  if (error) {
    for (const cookie of request.cookies.getAll()) {
      if (cookie.name.startsWith("sb-")) {
        response.cookies.set(cookie.name, "", { path: "/", maxAge: 0 });
      }
    }
  }
  return response;
}
