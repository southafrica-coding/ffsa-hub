// ────────────────────────────────────────────────────────────
// FFSA Hub — Google Calendar ACL Integration
// ────────────────────────────────────────────────────────────
// Shares the FFSA base Google Calendar with staff (read-only)
// via the Calendar ACL API. Requires a one-time OAuth connect
// flow to store a refresh token (see /api/integrations/google-calendar/).
// ────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export function googleCalendarRedirectUri(): string {
  return (
    process.env.GOOGLE_OAUTH_REDIRECT_URI ??
    "http://localhost:3000/api/integrations/google-calendar/callback"
  );
}

// ────────────────────────────────────────────────────────────
// TOKEN MANAGEMENT (Supabase)
// ────────────────────────────────────────────────────────────

export async function getStoredCalendarTokens(supabase: Client) {
  const { data, error } = await supabase
    .from("google_calendar_tokens")
    .select("*")
    .eq("key", "default")
    .maybeSingle();
  if (error || !data) return null;
  return data as {
    key: string;
    refresh_token: string;
    access_token: string | null;
    expires_at: string | null;
    connected_by: string | null;
    updated_at: string;
  };
}

export async function saveCalendarTokens(
  supabase: Client,
  data: {
    refresh_token: string;
    access_token: string;
    expires_at: string;
    connected_by?: string;
  }
) {
  const { error } = await supabase
    .from("google_calendar_tokens")
    .upsert(
      {
        key: "default",
        refresh_token: data.refresh_token,
        access_token: data.access_token,
        expires_at: data.expires_at,
        connected_by: data.connected_by ?? null,
      },
      { onConflict: "key" }
    );
  return { error };
}

export async function deleteCalendarTokens(supabase: Client) {
  const { error } = await supabase
    .from("google_calendar_tokens")
    .delete()
    .eq("key", "default");
  return { error };
}

// ────────────────────────────────────────────────────────────
// ACCESS TOKEN REFRESH
// ────────────────────────────────────────────────────────────

async function getAccessToken(): Promise<string | null> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.warn("[google-calendar] OAuth client env vars not set");
    return null;
  }

  const admin = createAdminClient();
  const tokens = await getStoredCalendarTokens(admin);
  if (!tokens) {
    console.warn("[google-calendar] no stored tokens — run the connect flow");
    return null;
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    console.error("[google-calendar] token refresh failed:", await res.text());
    return null;
  }

  const json = await res.json();
  return json.access_token as string;
}

// ────────────────────────────────────────────────────────────
// CALENDAR ACL
// ────────────────────────────────────────────────────────────

export async function addUserToBaseCalendar(email: string): Promise<void> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) {
    console.warn("[google-calendar] GOOGLE_CALENDAR_ID not set — skipping");
    return;
  }

  const accessToken = await getAccessToken();
  if (!accessToken) return;

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/acl`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      role: "reader",
      scope: { type: "user", value: email },
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const reason =
      body?.error?.errors?.[0]?.reason ??
      body?.error?.message ??
      String(res.status);
    // Already shared — not an error
    if (reason === "duplicate" || reason === "alreadyExists") {
      console.log(`[google-calendar] ${email} already has access`);
      return;
    }
    // Non-Google email address — log quietly, don't break onboarding
    console.warn(`[google-calendar] ACL insert failed for ${email}: ${reason}`);
    return;
  }

  console.log(`[google-calendar] shared base calendar with ${email}`);
}
