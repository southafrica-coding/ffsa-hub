/**
 * Confirm / Cancel on a change the "Hub" assistant proposed.
 *
 * The button carries only the pending action's id. On Confirm, every
 * check runs again from scratch — is the clicker the leader who asked,
 * do they still lead the ministry, is the person still on their team, do
 * they still hold the permission — before the change is made, audited and
 * the row closed. Expired, cancelled or already-used rows write nothing.
 */

import { inviteEmailHtml } from "@/lib/email/templates/invite";
import { sendSetupLink } from "@/lib/auth/send-setup-link";
import { resolveHubUserBySlackId } from "@/services/slack-bot";
import * as data from "./data";
import { checkPermissionChange, checkResendInvite, type Leader } from "./rules";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export const ACTION_CONFIRM = "hub_assistant_confirm";
export const ACTION_CANCEL = "hub_assistant_cancel";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isPendingId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Block Kit for a proposed change: the summary, then Confirm and Cancel. */
export function confirmationBlocks(summary: string, pendingId: string) {
  return [
    { type: "section", text: { type: "mrkdwn", text: summary } },
    {
      type: "actions",
      elements: [
        { type: "button", action_id: ACTION_CONFIRM, style: "primary", text: { type: "plain_text", text: "Confirm" }, value: pendingId },
        { type: "button", action_id: ACTION_CANCEL, text: { type: "plain_text", text: "Cancel" }, value: pendingId },
      ],
    },
    { type: "context", elements: [{ type: "mrkdwn", text: "Nothing changes until you press Confirm. This expires in 10 minutes." }] },
  ];
}

export type ConfirmResult = { text: string };

const GONE = "This request has expired or was already handled, so nothing was changed. Ask me again if you still need it.";

/** Load the row and check the clicker is the leader who asked. */
async function loadOwned(admin: Client, pendingId: string, slackUserId: string) {
  const row = await data.getPending(admin, pendingId);
  if (!row) return { error: GONE };
  if (row.slack_user_id !== slackUserId) return { error: "Only the person who asked for this can confirm or cancel it." };
  if (row.consumed_at || row.cancelled_at || new Date(row.expires_at).getTime() <= Date.now()) return { error: GONE };
  return { row };
}

export async function cancelPending(admin: Client, pendingId: string, slackUserId: string): Promise<ConfirmResult> {
  const loaded = await loadOwned(admin, pendingId, slackUserId);
  if (!loaded.row) return { text: loaded.error };
  const closed = await data.claimPending(admin, pendingId, "cancelled", "cancelled");
  if (!closed) return { text: GONE };
  await data.writeAssistantAudit(admin, {
    leader_hub_user_id: loaded.row.leader_hub_user_id,
    slack_user_id: slackUserId,
    action: loaded.row.action_type,
    target_user_id: str(loaded.row.payload.target_user_id),
    pending_action_id: pendingId,
    payload: loaded.row.payload,
    result: "cancelled",
  });
  return { text: "Cancelled. Nothing was changed." };
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export async function confirmPending(admin: Client, pendingId: string, slackUserId: string): Promise<ConfirmResult> {
  const loaded = await loadOwned(admin, pendingId, slackUserId);
  if (!loaded.row) return { text: loaded.error };
  const row = loaded.row;
  const payload = row.payload;
  const targetUserId = str(payload.target_user_id);

  const audit = (result: data.AuditResult, detail?: string) =>
    data.writeAssistantAudit(admin, {
      leader_hub_user_id: row.leader_hub_user_id,
      slack_user_id: slackUserId,
      action: row.action_type,
      target_user_id: targetUserId,
      pending_action_id: pendingId,
      payload,
      result,
      detail: detail ?? null,
    });
  const refuse = async (reason: string) => {
    await data.claimPending(admin, pendingId, "cancelled", `refused: ${reason}`.slice(0, 500));
    await audit("refused", reason);
    return { text: `I didn't make that change: ${reason}` };
  };

  // The clicker must still be the same Hub user, and still a leader.
  const hubUserId = await resolveHubUserBySlackId(admin, slackUserId);
  if (!hubUserId || hubUserId !== row.leader_hub_user_id) return refuse("your Slack is no longer linked to the Hub account that asked.");
  const ministries = await data.getLedMinistries(admin, hubUserId);
  if (ministries.length === 0) return refuse("this assistant is only available to ministry leaders.");
  const leader: Leader = { hubUserId, slackUserId, ministries };
  if (!targetUserId) return refuse("the request is incomplete.");

  if (row.action_type === "grant_permission" || row.action_type === "revoke_permission") {
    const action = row.action_type === "grant_permission" ? "grant" : "revoke";
    const checked = await checkPermissionChange(admin, leader, {
      action,
      targetUserId,
      permissionKey: str(payload.permission_key) ?? "",
      scopeType: str(payload.scope_type),
      scopeId: str(payload.scope_id),
    });
    if (!checked.ok) return refuse(checked.reason);
    // Claim before writing, so a double click can't apply it twice.
    if (!(await data.claimPending(admin, pendingId, "consumed", "executing"))) return { text: GONE };

    const args = { userId: targetUserId, permissionId: checked.permission.id, scopeType: checked.scopeType, scopeId: checked.scopeId };
    const { error } = action === "grant" ? await data.applyGrant(admin, { ...args, grantedBy: hubUserId }) : await data.applyRevoke(admin, args);
    if (error) {
      await data.setPendingResult(admin, pendingId, "failed");
      await audit("failed", error.message);
      return { text: "Something went wrong making that change, so it may not have been made. Check the person's access in the Hub." };
    }
    await data.setPendingResult(admin, pendingId, "executed");
    await data.writeHubAudit(admin, {
      user_id: hubUserId,
      action: action === "grant" ? "grant_permission" : "revoke_permission",
      resource_type: "user_permissions",
      resource_id: targetUserId,
      changes: {
        source: "slack_hub_assistant",
        permission_key: checked.permission.key,
        scope_type: checked.scopeType,
        scope_id: checked.scopeId,
        pending_action_id: pendingId,
      },
    });
    await audit("executed");
    return {
      text:
        action === "grant"
          ? `Done. ${checked.target.name} now has ${checked.permission.display_name}.`
          : `Done. ${checked.permission.display_name} was removed from ${checked.target.name}.`,
    };
  }

  if (row.action_type === "resend_invite") {
    const checked = await checkResendInvite(admin, leader, targetUserId);
    if (!checked.ok) return refuse(checked.reason);
    if (!(await data.claimPending(admin, pendingId, "consumed", "executing"))) return { text: GONE };

    const sent = await sendSetupLink(admin, {
      userId: targetUserId,
      email: checked.email,
      firstName: checked.firstName,
      createdBy: hubUserId,
      subject: "Reminder: You're invited to FFSA Hub",
      html: (setupUrl) => inviteEmailHtml({ firstName: checked.firstName || undefined, inviteUrl: setupUrl }),
      category: "account_setup_link",
      sourceType: "users",
      sourceId: targetUserId,
      reason: `A ministry leader (${hubUserId}) resent their FFSA Hub invite from the Slack Hub assistant.`,
    });
    if (!sent.ok) {
      await data.setPendingResult(admin, pendingId, "failed");
      await audit("failed", sent.suppressed ? "suppressed" : sent.error);
      return {
        text: sent.suppressed
          ? `That email address has bounced before, so I can't send to it. A Hub admin can copy a setup link for ${checked.target.name}.`
          : "Something went wrong sending the invite. Try again later, or ask a Hub admin.",
      };
    }
    await data.setPendingResult(admin, pendingId, "executed");
    await data.writeHubAudit(admin, {
      user_id: hubUserId,
      action: "resend_invite",
      resource_type: "users",
      resource_id: targetUserId,
      changes: { email: checked.email, source: "slack_hub_assistant", pending_action_id: pendingId },
    });
    await audit("executed");
    return { text: `Done. I've resent the Hub invite to ${checked.target.name}.` };
  }

  return refuse("I don't recognise that request.");
}
