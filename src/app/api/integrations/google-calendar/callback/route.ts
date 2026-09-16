import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { saveCalendarTokens, googleCalendarRedirectUri } from "@/lib/google/calendar";

const SETTINGS_URL = `${process.env.NEXT_PUBLIC_SITE_URL}/settings`;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_SITE_URL}/login`);
  }

  if (error || !code) {
    const msg = error ?? "no_code";
    console.error("[google-calendar/callback] error from Google:", msg);
    return NextResponse.redirect(
      `${SETTINGS_URL}?gcal=error&message=${encodeURIComponent(msg)}`
    );
  }

  try {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET!;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: googleCalendarRedirectUri(),
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("[google-calendar/callback] token exchange failed:", tokenRes.status, errText);
      return NextResponse.redirect(
        `${SETTINGS_URL}?gcal=error&message=Token+exchange+failed`
      );
    }

    const tokenSet = await tokenRes.json();

    if (!tokenSet.refresh_token) {
      console.error("[google-calendar/callback] no refresh_token in response — prompt=consent missing?");
      return NextResponse.redirect(
        `${SETTINGS_URL}?gcal=error&message=No+refresh+token+received`
      );
    }

    const expiresAt = new Date(
      Date.now() + (tokenSet.expires_in ?? 3600) * 1000
    ).toISOString();

    const admin = createAdminClient();
    await saveCalendarTokens(admin, {
      refresh_token: tokenSet.refresh_token,
      access_token: tokenSet.access_token,
      expires_at: expiresAt,
      connected_by: user.id,
    });

    console.log("[google-calendar/callback] tokens saved for", user.id);
    return NextResponse.redirect(`${SETTINGS_URL}?gcal=connected`);
  } catch (err) {
    console.error("[google-calendar/callback] error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.redirect(
      `${SETTINGS_URL}?gcal=error&message=${encodeURIComponent(message)}`
    );
  }
}
