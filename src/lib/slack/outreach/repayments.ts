/**
 * Confirms a no-receipt repayment. Does not create an expense and does not
 * call Xero. The row lands in budget_repayments once Hub Data has created
 * that table; until then the Slack reply is the record.
 */

import { isMissingRelation } from "@/lib/finance/budget-actuals";
import { parseRepayValue } from "./no-receipt";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

async function isTeamOwner(admin: Admin, teamId: string, hubUserId: string): Promise<boolean> {
  const { data } = await admin
    .from("outreach_team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", hubUserId)
    .eq("role", "owner")
    .maybeSingle();
  return Boolean(data);
}

export async function confirmRepayment(
  admin: Admin,
  slackUserId: string,
  rawValue: string | undefined
): Promise<{ text: string }> {
  const claim = parseRepayValue(rawValue);
  if (!claim) return { text: "I couldn't read that repayment. Send it again with the amount." };

  const { data: user } = await admin.from("users").select("id").eq("slack_user_id", slackUserId).maybeSingle();
  const hubUserId = (user as { id: string } | null)?.id ?? null;
  const owner = claim.teamId && hubUserId ? await isTeamOwner(admin, claim.teamId, hubUserId) : false;
  if (slackUserId !== claim.claimantSlackId && !owner) {
    return { text: "Only the person who spent this, or the team owner, can confirm the repayment." };
  }

  const money = claim.currency === "ZAR" ? `R${(claim.amountCents / 100).toFixed(2)}` : `${claim.currency} ${(claim.amountCents / 100).toFixed(2)}`;

  const { data: prior, error: priorError } = await admin
    .from("budget_repayments")
    .select("id")
    .eq("slack_user_id", claim.claimantSlackId)
    .eq("amount_cents", claim.amountCents)
    .eq("currency", claim.currency)
    .eq("description", claim.description)
    .limit(1);
  if (priorError && !isMissingRelation(priorError)) {
    console.error("[slack/outreach] repayment lookup failed", priorError.message ?? priorError);
    return { text: `You repay ${money} for ${claim.description}. I couldn't check the list just now — try again in a moment. Nothing was sent to Xero.` };
  }
  if (!priorError && (prior ?? []).length) {
    return { text: `You already noted that you repay ${money} for ${claim.description}. Nothing was sent to Xero.` };
  }

  const { error } = await admin.from("budget_repayments").insert({
    hub_user_id: hubUserId,
    slack_user_id: slackUserId,
    team_id: claim.teamId,
    amount_cents: claim.amountCents,
    currency: claim.currency,
    description: claim.description,
    reason: "no_receipt",
    confirmed_at: new Date().toISOString(),
  });

  if (error && !isMissingRelation(error)) {
    console.error("[slack/outreach] repayment insert failed", error.message ?? error);
    return { text: `You repay ${money} for ${claim.description}. I couldn't save it just now — send it again in a moment. Nothing was sent to Xero.` };
  }

  const saved = !error;
  const tail = saved
    ? "It's noted."
    : "It's noted here in Slack. The repayment list in the Hub isn't switched on yet.";
  return {
    text: `You repay ${money} for ${claim.description}. It is not on the budget and it was not sent to Xero. ${tail}`,
  };
}
