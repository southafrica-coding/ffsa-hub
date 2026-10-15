import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { SLACK_USER_SCOPES, STATE_COOKIE, deleteSlackUserToken } from "@/lib/slack/user-tokens";

// "Connect my Slack" (migration 240).
//
// GET    — start: send the signed-in user to Slack's consent screen asking for
//          the user scopes the Hub needs to DM people as them. `?next=/path`
//          is where they land afterwards.
// DELETE — disconnect: forget their token.


function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/profile";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.redirect(new URL("/login", url.origin));

  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "Slack sign-in isn't set up yet (SLACK_CLIENT_ID missing)." },
      { status: 500 }
    );
  }

  const next = safeNext(url.searchParams.get("next"));
  const nonce = crypto.randomBytes(16).toString("hex");
  const state = `${nonce}.${Buffer.from(next).toString("base64url")}`;

  const authorize = new URL("https://slack.com/oauth/v2/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("user_scope", SLACK_USER_SCOPES.join(","));
  authorize.searchParams.set("redirect_uri", `${url.origin}/api/slack/user-oauth/callback`);
  authorize.searchParams.set("state", state);

  const res = NextResponse.redirect(authorize.toString());
  res.cookies.set(STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/slack/user-oauth",
    maxAge: 600,
  });
  return res;
}

export async function DELETE() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  await deleteSlackUserToken(createAdminClient(), user.id);
  return NextResponse.json({ ok: true });
}
