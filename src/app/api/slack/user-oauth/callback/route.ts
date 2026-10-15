import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { exchangeOAuthCode } from "@/lib/slack/client";
import { STATE_COOKIE, saveSlackUserToken } from "@/lib/slack/user-tokens";

// Slack sends the user back here after "Connect my Slack". Swap the code for
// their user token, make sure it's the Slack account already linked to their
// Hub profile (or link it if none is), store it, and return them to `next`.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const [nonce, nextB64] = (url.searchParams.get("state") ?? "").split(".");
  let next = "/profile";
  try {
    const decoded = Buffer.from(nextB64 ?? "", "base64url").toString();
    if (decoded.startsWith("/") && !decoded.startsWith("//")) next = decoded;
  } catch {
    /* keep default */
  }

  const back = (status: string) => {
    const to = new URL(next, url.origin);
    to.searchParams.set("slack", status);
    const res = NextResponse.redirect(to);
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/slack/user-oauth" });
    return res;
  };

  const jar = await cookies();
  if (!nonce || jar.get(STATE_COOKIE)?.value !== nonce) return back("state_mismatch");
  if (url.searchParams.get("error")) return back("cancelled");
  const code = url.searchParams.get("code");
  if (!code) return back("failed");

  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.redirect(new URL("/login", url.origin));

  const res = await exchangeOAuthCode(code, `${url.origin}/api/slack/user-oauth/callback`).catch(
    () => null
  );
  const authed = res?.ok ? res.authed_user : null;
  if (!authed?.id || !authed.access_token) {
    console.error("[slack/user-oauth] exchange failed", res?.error);
    return back("failed");
  }

  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: me } = await admin
    .from("users")
    .select("slack_user_id")
    .eq("id", user.id)
    .maybeSingle();
  const linked = (me?.slack_user_id as string | null) ?? null;
  if (linked && linked !== authed.id) return back("wrong_account");
  if (!linked) {
    // Not linked yet — this proves which Slack account is theirs. Refuse if
    // another Hub user already holds it.
    const { data: taken } = await admin
      .from("users")
      .select("id")
      .eq("slack_user_id", authed.id)
      .neq("id", user.id)
      .maybeSingle();
    if (taken) return back("taken");
    await admin
      .from("users")
      .update({
        slack_user_id: authed.id,
        slack_linked_at: new Date().toISOString(),
        slack_link_source: "self",
      })
      .eq("id", user.id);
  }

  const { error } = await saveSlackUserToken(admin, {
    userId: user.id,
    slackUserId: authed.id,
    teamId: res?.team?.id ?? null,
    accessToken: authed.access_token,
    scope: authed.scope ?? null,
  });
  if (error) return back("failed");
  return back("connected");
}
