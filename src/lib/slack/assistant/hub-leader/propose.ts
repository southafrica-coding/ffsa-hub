/**
 * Set up a change that waits for the leader's button press: one
 * slack_assistant_pending_actions row (the button carries only its id)
 * and a "proposed" audit line. Nothing else is written here; actions.ts
 * re-checks everything and makes the change on Confirm.
 */

import * as data from "./data";
import type { Leader } from "./rules";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/** A change waiting on the leader's button. `confirmLabel` is the button text (default "Confirm"). */
export type Proposal = { pendingId: string; summary: string; confirmLabel?: string; danger?: boolean };

export type ToolOutcome = { output: unknown; proposal?: Proposal };

export type ToolContext = { admin: Client; leader: Leader; channelId: string };

export async function propose(
  ctx: ToolContext,
  actionType: data.PendingActionType,
  payload: Record<string, unknown>,
  targetUserId: string | null,
  summary: string,
  button?: { confirmLabel: string; danger?: boolean }
): Promise<ToolOutcome> {
  const pendingId = await data.insertPending(ctx.admin, {
    leader_hub_user_id: ctx.leader.hubUserId,
    slack_user_id: ctx.leader.slackUserId,
    slack_channel_id: ctx.channelId,
    action_type: actionType,
    payload,
  });
  if (!pendingId) return { output: { error: "I couldn't set that up just now. Try again in a minute." } };
  await data.writeAssistantAudit(ctx.admin, {
    leader_hub_user_id: ctx.leader.hubUserId,
    slack_user_id: ctx.leader.slackUserId,
    action: actionType,
    target_user_id: targetUserId,
    pending_action_id: pendingId,
    payload,
    result: "proposed",
  });
  const label = button?.confirmLabel ?? "Confirm";
  return {
    output: {
      awaiting_confirmation: true,
      message: `Nothing has changed yet. A message with ${label} and Cancel buttons will be posted; it happens only if the leader presses ${label} within 10 minutes.`,
    },
    proposal: { pendingId, summary, ...(button ? { confirmLabel: button.confirmLabel, danger: button.danger } : {}) },
  };
}
