import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { setMyColorScheme } from "@/services/users";
import { isColorScheme, THEME_COOKIE, THEME_COOKIE_MAX_AGE } from "@/lib/theme";

// PUT /api/profile/appearance  { colorScheme: "light" | "dark" }
// Saves the caller's own Hub theme to their profile (migration 344) and
// mirrors it into the cookie the no-flash script reads, so the next page
// paints in the right mode on this device. The RPC writes only the caller's
// row; there is no way to set anyone else's.
export async function PUT(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const scheme = (body as { colorScheme?: unknown } | null)?.colorScheme;
  if (!isColorScheme(scheme)) {
    return NextResponse.json({ error: "Pick light or dark." }, { status: 400 });
  }

  const { error } = await setMyColorScheme(supabase, scheme);
  if (error) {
    console.error("[appearance] save failed", error);
    return NextResponse.json(
      { error: "Couldn't save your setting. Please try again." },
      { status: 500 }
    );
  }

  const res = NextResponse.json({ success: true, colorScheme: scheme });
  res.cookies.set(THEME_COOKIE, scheme, {
    path: "/",
    maxAge: THEME_COOKIE_MAX_AGE,
    sameSite: "lax",
  });
  return res;
}
