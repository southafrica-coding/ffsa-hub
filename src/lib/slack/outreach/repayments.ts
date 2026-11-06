/**
 * Confirms a no-receipt repayment. Does not create an expense and does not
 * call Xero. The row lands in budget_repayments once Hub Data has created
 * that table; until then the Slack reply is the record.
 */

import { isMissingRelation } from "@/lib/finance/budget-actuals";
import { parseRepayValue } from "./no-receipt";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export async function confirmRepayment(
  admin: Admin,
  slackUserId: string,
  rawValue: string | undefined
): Promise<{ text: string }> {
  const claim = parseRepayValue(rawValue);
  if (!claim) return { text: "I couldn't read that repayment. Send it again with the amount." };

  const { data: user } = await admin.from("users").select("id").eq("slack_user_id", slackUserId).maybeSingle();
  const hubUserId = (user as { id: string } | null)?.id ?? null;
  const money = claim.currency === "ZAR" ? `R${(claim.amountCents / 100).toFixed(2)}` : `${claim.currency} ${(claim.amountCents / 100).toFixed(2)}`;

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
