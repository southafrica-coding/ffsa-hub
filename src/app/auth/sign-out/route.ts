import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Sign-out has to clear the cookies on the response that sends the browser
// to /login. The sidebar used to call the browser client and then
// router.push("/login"). Middleware still saw the session (it sends every
// signed-in visit to /login straight back to /dashboard), so the click
// showed the admin loading state and landed on the dashboard again.
//
// A form POST to this route is a full navigation. signOut writes the
// cleared cookies onto the redirect itself, and the next GET /login has
// no session for middleware to bounce. A failed sign-out still redirects,
// with ?error=signout, and any cookies signOut did clear travel with it.

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
  const url = new URL("/login", request.url);
  if (error) url.searchParams.set("error", "signout");
  const response = NextResponse.redirect(url, { status: 303 });
  for (const cookie of cleared) {
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  return response;
}
