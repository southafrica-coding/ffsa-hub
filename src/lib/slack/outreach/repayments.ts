/**
 * Confirms a no-receipt repayment. Does not create an expense and does not
 * call Xero. The row lands in budget_repayments once Hub Data has created
 * that table; until then the Slack reply is the record.
 */

import { isMissingRelation } from "@/lib/finance/budget-actuals";
import { repaymentIdempotencyToken, repaymentLogRow } from "@/lib/finance/budget-log-rows";
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

function isUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "23505" || /duplicate key|unique constraint/i.test(error.message ?? "");
}

export async function confirmRepayment(
  admin: Admin,
  slackUserId: string,
  rawValue: string | undefined,
  source?: { messageTs?: string | null }
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
  // The confirm token is the card's message ts, or the draft id when the click has no ts.
  // Description, amount, and reason are not the key: two real purchases can share them.
  const token = repaymentIdempotencyToken({
    messageTs: source?.messageTs,
    receiptDraftId: claim.receiptDraftId,
  });
  if (!token) {
    return {
      text: `You repay ${money} for ${claim.description}. It's noted here in Slack. I couldn't tie it to this confirm, so it isn't saved on the budget. Nothing was sent to Xero.`,
    };
  }
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
    idempotencyToken: token,
  });
  if (!row) {
    return {
      text: `You repay ${money} for ${claim.description}. It's noted here in Slack. It isn't on a budget in that currency, and nothing was sent to Xero.`,
    };
  }

  const { data: prior, error: priorError } = await admin
    .from("budget_repayments")
    .select("id")
    .eq("slack_message_ts", row.slack_message_ts)
    .limit(1);
  if (priorError && !isMissingRelation(priorError)) {
    console.error("[slack/outreach] repayment lookup failed", priorError.message ?? priorError);
    return { text: `You repay ${money} for ${claim.description}. I couldn't check the list just now — try again in a moment. Nothing was sent to Xero.` };
  }
  if (!priorError && (prior ?? []).length) {
    return { text: `You already noted that you repay ${money} for ${claim.description}. Nothing was sent to Xero.` };
  }

  const { error } = await admin.from("budget_repayments").insert(row);

  if (error && isUniqueViolation(error)) {
    return { text: `You already noted that you repay ${money} for ${claim.description}. Nothing was sent to Xero.` };
  }
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
