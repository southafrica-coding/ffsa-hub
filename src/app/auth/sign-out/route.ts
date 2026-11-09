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
// no session for middleware to bounce.

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url), { status: 303 });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { error } = await supabase.auth.signOut();
  if (error) {
    // Stay off /login while the session is still there. Middleware would
    // send that request back to /dashboard.
    return NextResponse.json({ error: "Could not sign out. Please try again." }, { status: 500 });
  }

  return response;
}
