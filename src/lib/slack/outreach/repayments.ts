/**
 * Confirms a no-receipt repayment. Does not create an expense and does not
 * call Xero. The row lands in budget_repayments once Hub Data has created
 * that table; until then the Slack reply is the record.
 */

import { isMissingRelation } from "@/lib/finance/budget-actuals";
import { repaymentLogRow } from "@/lib/finance/budget-log-rows";
import { sastDate } from "@/lib/slack/assistant/outreach";
import { parseRepayValue } from "./no-receipt";
import { budgetForSlip } from "./receipts";

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
  const { data: claimant } = await admin.from("users").select("id").eq("slack_user_id", claim.claimantSlackId).maybeSingle();
  const claimantHubId = (claimant as { id: string } | null)?.id ?? null;
  const budget = await budgetForSlip(admin, {
    teamId: claim.teamId,
    localCurrency: claim.currency,
    expenseDate: sastDate(new Date()),
    nameHint: claim.description,
  });
  const row = repaymentLogRow({
    budgetId: budget?.budgetId ?? null,
    lineId: budget?.lineId ?? null,
    hubUserId: claimantHubId,
    slackUserId: claim.claimantSlackId,
    teamId: budget ? claim.teamId : null,
    amountCents: claim.amountCents,
    amountCurrency: claim.currency,
    budgetCurrency: budget?.currency ?? null,
    description: claim.description,
    confirmedAt: new Date().toISOString(),
  });
  if (!row) {
    return {
      text: `You repay ${money} for ${claim.description}. It's noted here in Slack. It isn't on a budget in that currency, and nothing was sent to Xero.`,
    };
  }

  let priorQuery = admin
    .from("budget_repayments")
    .select("id")
    .eq("budget_id", row.budget_id)
    .eq("slack_user_id", row.slack_user_id)
    .eq("amount_cents", row.amount_cents)
    .eq("reason", row.reason)
    .ilike("description", row.description);
  priorQuery = row.line_id ? priorQuery.eq("line_id", row.line_id) : priorQuery.is("line_id", null);
  priorQuery = row.hub_user_id ? priorQuery.eq("hub_user_id", row.hub_user_id) : priorQuery.is("hub_user_id", null);
  priorQuery = row.team_id ? priorQuery.eq("team_id", row.team_id) : priorQuery.is("team_id", null);
  const { data: prior, error: priorError } = await priorQuery.limit(1);
  if (priorError && !isMissingRelation(priorError)) {
    console.error("[slack/outreach] repayment lookup failed", priorError.message ?? priorError);
    return { text: `You repay ${money} for ${claim.description}. I couldn't check the list just now — try again in a moment. Nothing was sent to Xero.` };
  }
  if (!priorError && (prior ?? []).length) {
    return { text: `You already noted that you repay ${money} for ${claim.description}. Nothing was sent to Xero.` };
  }

  const { error } = await admin.from("budget_repayments").insert(row);

  if (error && !isMissingRelation(error)) {
    console.error("[slack/outreach] repayment insert failed", error.message ?? error);
    return { text: `You repay ${money} for ${claim.description}. I couldn't save it just now — send it again in a moment. Nothing was sent to Xero.` };
  }

  const saved = !error;
  const tail = saved
    ? "It's noted on the budget."
    : "It's noted here in Slack. The repayment list in the Hub isn't switched on yet.";
  return {
    text: `You repay ${money} for ${claim.description}. ${tail} Nothing was sent to Xero.`,
  };
}
