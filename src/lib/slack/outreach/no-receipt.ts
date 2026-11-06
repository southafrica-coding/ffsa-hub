/**
 * A spend with no receipt is not a budget expense. The purchaser repays it.
 * Nothing is written to Xero and nothing is inserted into outreach_expenses.
 */

import { parseTypedAmount } from "./receipt-logic";

export const ACTION_REPAY = "receipt_repay";

export const NO_RECEIPT_RULE =
  "No receipt, so you repay this yourself. It does not come out of the budget, and it is not sent to Xero.";

const NO_RECEIPT_PHRASE =
  /\bno receipt\b|\bwithout a receipt\b|\blost (the )?(receipt|slip)\b|\bforgot (the )?(receipt|slip)\b|\bno slip\b|\bdidn'?t get a receipt\b/i;

const QUESTION_START = /^(how|what|what's|whats|which|when|who|where|why|can|could|is|are|do|does|did|should)\b/i;

export type BareMessage = "question" | "no_receipt" | "other";

/** What a Slack message with no photo is. Questions stay with the budget assistant. */
export function classifyBareMessage(text: string): BareMessage {
  const t = text.trim();
  if (!t) return "other";
  // A question wins even when it mentions a receipt. "What happens if I have no receipt?"
  if (t.includes("?") || QUESTION_START.test(t)) return "question";
  if (NO_RECEIPT_PHRASE.test(t)) return "no_receipt";
  // A running total is not a purchase without a slip. "We spent R2000 so far."
  if (/\b(so far|in total|altogether|already|this week|this month|left|remaining)\b/i.test(t)) return "other";
  // First person, a specific purchase. "We spent…" without "no receipt" is chat.
  if (/\b(i|i've)\s+(spent|paid|bought|purchased)\b/i.test(t) && /\d/.test(t)) return "no_receipt";
  return "other";
}

export type SpendClaim = {
  amount: number;
  currency: string;
  description: string;
};

const MONEY =
  /(?:R|ZAR|USD|BWP|P|\$)\s*([0-9][0-9 .,]*\d|\d)|([0-9][0-9 .,]*\d|\d)\s*(rand|zar|usd|bwp|pula)\b/i;

/** Pulls an amount out of a no-receipt message. Null when they didn't name one. */
export function parseSpendClaim(text: string): SpendClaim | null {
  const match = text.match(MONEY);
  if (!match) return null;
  const raw = match[1] ?? match[2];
  const amount = parseTypedAmount(raw);
  if (amount == null || amount <= 0) return null;
  const token = match[0].toLowerCase();
  const currency = token.includes("usd") || token.includes("$")
    ? "USD"
    : token.includes("bwp") || token.includes("pula") || /^p\s*\d/.test(token)
      ? "BWP"
      : "ZAR";
  const description = text
    .replace(match[0], " ")
    .replace(NO_RECEIPT_PHRASE, " ")
    .replace(/\b(i|i've|we|we've)?\s*(spent|paid|bought|purchased)\b/i, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "")
    .slice(0, 80);
  return { amount: Math.round(amount * 100) / 100, currency, description: description || "Purchase" };
}

export function repaymentSentence(claim: SpendClaim | null, teamName: string | null): string {
  const where = teamName ? ` It is not on *${teamName}*'s budget.` : " It is not on the budget.";
  if (!claim) {
    return `${NO_RECEIPT_RULE} Say the amount (for example "no receipt, R180 for a taxi") if you want it noted.`;
  }
  const money = claim.currency === "ZAR" ? `R${claim.amount.toFixed(2)}` : `${claim.currency} ${claim.amount.toFixed(2)}`;
  return `No receipt, so you repay *${money}* for ${claim.description}.${where} It is not sent to Xero.`;
}

/** Button value: cents, currency, team id or "-", claimant Slack id, draft id or "-", description. Slack's limit is 2000. */
export function repayValue(args: {
  amountCents: number;
  currency: string;
  teamId: string | null;
  claimantSlackId: string;
  description: string;
  receiptDraftId?: string | null;
}): string {
  const desc = args.description.replace(/\|/g, " ").slice(0, 80);
  const draft = args.receiptDraftId?.trim() || "-";
  return `${args.amountCents}|${args.currency}|${args.teamId ?? "-"}|${args.claimantSlackId}|${draft}|${desc}`;
}

export function parseRepayValue(value: string | undefined): {
  amountCents: number;
  currency: string;
  teamId: string | null;
  claimantSlackId: string;
  receiptDraftId: string | null;
  description: string;
} | null {
  const [centsRaw, currency, team, claimant, draft, ...rest] = (value ?? "").split("|");
  const amountCents = Number(centsRaw);
  if (!Number.isInteger(amountCents) || amountCents <= 0) return null;
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return null;
  if (!claimant || !/^U[A-Z0-9]+$/.test(claimant)) return null;
  const description = rest.join("|").trim();
  if (!description) return null;
  const receiptDraftId = draft && draft !== "-" ? draft.slice(0, 64) : null;
  return {
    amountCents,
    currency,
    teamId: team && team !== "-" ? team : null,
    claimantSlackId: claimant,
    receiptDraftId,
    description: description.slice(0, 80),
  };
}

export function repaymentBlocks(text: string, value: string | null): unknown[] {
  const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text } }];
  if (value) {
    blocks.push({
      type: "actions",
      block_id: "receipt_repay",
      elements: [
        {
          type: "button",
          style: "primary",
          action_id: ACTION_REPAY,
          value,
          text: { type: "plain_text", text: "I'll repay this" },
          confirm: {
            title: { type: "plain_text", text: "You repay this?" },
            text: { type: "plain_text", text: "It will not be logged on the budget and it will not be sent to Xero." },
            confirm: { type: "plain_text", text: "Yes, I'll repay it" },
            deny: { type: "plain_text", text: "Back" },
          },
        },
      ],
    });
  }
  return blocks;
}
