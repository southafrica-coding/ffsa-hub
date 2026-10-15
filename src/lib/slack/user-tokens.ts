// "Connect my Slack" — a Hub user's own Slack user token (migration 240).
//
// With it the Hub can send a DM *as that person*, so the recipient replies to
// them directly instead of to the bot. Server-only: tokens are read and
// written with the admin client and never leave the server.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/** CSRF nonce cookie for the connect round-trip. */
export const STATE_COOKIE = "slack_user_oauth_state";

/** User scopes requested on connect. */
export const SLACK_USER_SCOPES = ["chat:write", "im:write", "im:history"];

export type SlackUserToken = { slackUserId: string; accessToken: string; scope: string | null };

export async function getSlackUserToken(admin: Client, userId: string): Promise<SlackUserToken | null> {
  const { data } = await admin
    .from("slack_user_tokens")
    .select("slack_user_id, access_token, scope")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data?.access_token) return null;
  return {
    slackUserId: data.slack_user_id as string,
    accessToken: data.access_token as string,
    scope: (data.scope as string | null) ?? null,
  };
}

export async function saveSlackUserToken(
  admin: Client,
  row: { userId: string; slackUserId: string; teamId: string | null; accessToken: string; scope: string | null }
) {
  return admin.from("slack_user_tokens").upsert(
    {
      user_id: row.userId,
      slack_user_id: row.slackUserId,
      team_id: row.teamId,
      access_token: row.accessToken,
      scope: row.scope,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
}

export async function deleteSlackUserToken(admin: Client, userId: string) {
  return admin.from("slack_user_tokens").delete().eq("user_id", userId);
}

/** Has this person connected, with every scope we need? */
export function hasAllScopes(scope: string | null): boolean {
  const have = new Set((scope ?? "").split(",").map((s) => s.trim()));
  return SLACK_USER_SCOPES.every((s) => have.has(s));
}
