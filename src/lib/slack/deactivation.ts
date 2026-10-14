// Slack deactivation → HUB deactivation.
//
// When someone is deactivated in the Slack workspace, the HUB account
// linked to that Slack member (users.slack_user_id) is switched off:
// users.is_active = false, which middleware enforces on every request
// (blocks sign-in and ends open sessions; no data is touched).
//
// Two ways in, same rules:
//   • /api/slack/events — Slack's user_change event, within seconds.
//   • /api/cron/slack-deactivation-sync — daily backstop for missed events.
//
// Rules agreed with the ops team (2026-10-14):
//   • Admins and super admins are never switched off automatically —
//     admins get an alert instead, so a mis-click in Slack can't lock out
//     the people who run the HUB.
//   • Reactivating someone in Slack does NOT reactivate them here; that's
//     done by hand from Users.
// Every deactivation writes audit_logs and posts to the activity channel.

import * as slack from "@/lib/slack/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const PROTECTED_ROLES = new Set(["admin", "super_admin"]);

export type SlackDeactivationOutcome =
  | "deactivated"
  | "protected_admin"
  | "already_inactive"
  | "not_linked";

export async function handleSlackDeactivation(
  admin: Client,
  slackUserId: string,
  via: "event" | "daily_sync"
): Promise<{ outcome: SlackDeactivationOutcome; userId?: string; name?: string }> {
  const { data: user } = await admin
    .from("users")
    .select(
      "id, first_name, last_name, email, is_active, user_roles!user_roles_user_id_fkey(roles(name))"
    )
    .eq("slack_user_id", slackUserId)
    .maybeSingle();

  if (!user) return { outcome: "not_linked" };

  const name =
    `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.email || "Someone";

  if (user.is_active === false) {
    return { outcome: "already_inactive", userId: user.id, name };
  }

  const roleNames = ((user.user_roles ?? []) as Array<{
    roles: { name?: string } | { name?: string }[] | null;
  }>).map((ur) => (Array.isArray(ur.roles) ? ur.roles[0] : ur.roles)?.name);
  const isProtected = roleNames.some((r) => r && PROTECTED_ROLES.has(r));

  if (isProtected) {
    // Alert once per person: the daily backstop sees the same deactivated
    // admin every day until someone acts, and shouldn't repeat itself.
    const { data: alreadyAlerted } = await admin
      .from("audit_logs")
      .select("id")
      .eq("action", "slack_deactivation_skipped_admin")
      .eq("resource_id", user.id)
      .limit(1);
    if (alreadyAlerted && alreadyAlerted.length > 0) {
      return { outcome: "protected_admin", userId: user.id, name };
    }
    await notifyAdmins(
      `:warning: *${name}* was deactivated in Slack. They're a HUB admin, so their HUB account was *not* switched off automatically — deactivate them from Users if that's intended.`
    );
    await admin.from("audit_logs").insert({
      user_id: null,
      action: "slack_deactivation_skipped_admin",
      resource_type: "users",
      resource_id: user.id,
      changes: { reason: "slack_deactivated", slack_user_id: slackUserId, via },
    });
    return { outcome: "protected_admin", userId: user.id, name };
  }

  const { error } = await admin
    .from("users")
    .update({ is_active: false })
    .eq("id", user.id)
    .eq("is_active", true);
  if (error) {
    console.error("[slack-deactivation] update failed", user.id, error);
    throw new Error(error.message);
  }

  await admin.from("audit_logs").insert({
    user_id: null,
    action: "deactivate_user",
    resource_type: "users",
    resource_id: user.id,
    changes: {
      is_active: false,
      reason: "slack_deactivated",
      slack_user_id: slackUserId,
      via,
    },
  });

  await notifyAdmins(
    `:no_entry: *${name}* was deactivated in Slack, so their HUB account has been switched off. If they come back, reactivate them from Users in the HUB.`
  );

  return { outcome: "deactivated", userId: user.id, name };
}

/** Best-effort note to the activity channel. Never throws. */
export async function notifyAdmins(text: string) {
  const channel = process.env.SLACK_ACTIVITY_CHANNEL_ID;
  if (!channel || !process.env.SLACK_BOT_TOKEN) return;
  try {
    const res = await slack.postMessage({ channel, text });
    if (!res.ok) console.error("[slack-deactivation] notify failed", res.error);
  } catch (err) {
    console.error("[slack-deactivation] notify threw", err);
  }
}
