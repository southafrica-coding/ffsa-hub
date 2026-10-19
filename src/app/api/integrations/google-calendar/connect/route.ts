import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callerIsAdmin } from "@/lib/auth/check-ministry-access";
import { googleCalendarRedirectUri } from "@/lib/google/calendar";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_SITE_URL}/login`);
    }
    // The shared calendar connection is managed from admin-only Settings.
    if (!(await callerIsAdmin(supabase, user.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    if (!clientId) {
      return NextResponse.json(
        { error: "GOOGLE_OAUTH_CLIENT_ID is not configured" },
        { status: 500 }
      );
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: googleCalendarRedirectUri(),
      response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar",
      access_type: "offline",
      // prompt=consent forces Google to return a refresh_token even if the
      // user has previously authorised this app (without it, subsequent
      // authorisations may omit the refresh_token).
      prompt: "consent",
    });

    const consentUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return NextResponse.redirect(consentUrl);
  } catch (err) {
    console.error("[google-calendar/connect] error:", err);
    return NextResponse.json(
      { error: "Failed to initiate Google Calendar connection" },
      { status: 500 }
    );
  }
}
