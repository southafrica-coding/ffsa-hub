/**
 * Card payments confirmed by the bank — the pure part (migration 265).
 *
 * Abroad, a card receipt shows the local amount; the rand only shows on
 * the bank's notification. Sent together, the two are paired here: local
 * from the receipt, rand from the bank, the rate worked out from both.
 * Sent later on its own, a notification is matched to the sender's card
 * payments still waiting for one.
 *
 * A fee the bank lists separately is kept out of the purchase and logged
 * in Bank Costs, so the purchase's rate stays clean.
 */

import { money, opt, type Proposal, type ReceiptReading } from "./receipt-logic";

export const ACTION_CARD_CONFIRM = "card_confirm";

const cents = (n: number) => Math.round(n * 100) / 100;

/** Off by more than this (1%) and a receipt and notification don't belong together. */
const MATCH_TOLERANCE = 0.01;
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, MATCH_TOLERANCE * Math.max(a, b));

/** What the notification says left the account: total, the fee part, and the purchase. */
export function bankAmounts(n: ReceiptReading): { total: number; fee: number; purchase: number } | null {
  const total = n.bank_zar_total != null && n.bank_zar_total > 0 ? cents(n.bank_zar_total) : null;
  if (total == null) return null;
  const fee = n.bank_zar_fee != null && n.bank_zar_fee > 0 && n.bank_zar_fee < total ? cents(n.bank_zar_fee) : 0;
  return { total, fee, purchase: cents(total - fee) };
}

type ReceiptSide = { total: number | null; currency: string | null };
type NoticeSide = { foreignAmount: number | null; foreignCurrency: string | null; zarTotal: number | null };

/** Does this notification describe this receipt's payment? */
function sameAmount(r: ReceiptSide, n: NoticeSide): boolean {
  if (r.total == null) return false;
  if ((r.currency ?? "").toUpperCase() === "ZAR") return n.zarTotal != null && close(r.total, n.zarTotal);
  return (
    n.foreignAmount != null &&
    close(r.total, n.foreignAmount) &&
    (!n.foreignCurrency || n.foreignCurrency.toUpperCase() === (r.currency ?? "").toUpperCase())
  );
}

/**
 * Pair receipts with the notifications sent alongside them. One of each
 * pairs regardless (flagged if the amounts disagree); with several, only
 * pairs whose amounts match are made, each used once.
 */
export function pairCardNotices(
  receipts: ReceiptSide[],
  notices: NoticeSide[]
): { receipt: number; notice: number; mismatch: boolean }[] {
  if (receipts.length === 1 && notices.length === 1) {
    const n = notices[0];
    const checkable = n.foreignAmount != null || (receipts[0].currency ?? "").toUpperCase() === "ZAR";
    return [{ receipt: 0, notice: 0, mismatch: checkable && !sameAmount(receipts[0], n) }];
  }
  const used = new Set<number>();
  const pairs: { receipt: number; notice: number; mismatch: boolean }[] = [];
  receipts.forEach((r, ri) => {
    const ni = notices.findIndex((n, i) => !used.has(i) && sameAmount(r, n));
    if (ni >= 0) {
      used.add(ni);
      pairs.push({ receipt: ri, notice: ni, mismatch: false });
    }
  });
  return pairs;
}

/** A receipt's proposal, re-priced from the bank: a confirmed card payment. */
export function confirmWithBank(p: Proposal, notice: ReceiptReading): { proposal: Proposal; warnings: string[] } {
  const bank = bankAmounts(notice);
  if (!bank) {
    return { proposal: p, warnings: ["Couldn't read the rand on the bank notification — it's recorded as an estimate for now."] };
  }
  const local = p.local_amount;
  const proposal: Proposal = {
    ...p,
    payment_method: "card",
    zar_amount: bank.purchase,
    exchange_rate: local != null && local > 0 ? local / bank.purchase : p.exchange_rate,
    rate_label: "confirmed by your bank",
    cash_batch_id: null,
    zar_confirmed: true,
    bank_fee_zar: bank.fee,
  };
  return { proposal, warnings: [] };
}

// ────────────────────────────────────────────────────────────
// A notification on its own: which card payment is it for?
// ────────────────────────────────────────────────────────────

export type CardCandidate = {
  id: string;
  team_id: string;
  team_name: string;
  vendor: string | null;
  description: string;
  expense_date: string;
  local_amount: number;
  local_currency: string;
  zar_amount: number; // the estimate
};

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.abs(new Date(a + "T00:00:00Z").getTime() - new Date(b + "T00:00:00Z").getTime()) / DAY;

/**
 * The sender's unconfirmed card payments this notification could be for:
 * same foreign amount (within 1%) when the bank shows it, else rand within
 * 15% of the estimate; nearest date first.
 */
export function matchCardCandidates(notice: ReceiptReading, all: CardCandidate[]): CardCandidate[] {
  const bank = bankAmounts(notice);
  const date = notice.date && /^\d{4}-\d{2}-\d{2}$/.test(notice.date) ? notice.date : null;
  const foreign = notice.bank_foreign_amount != null && notice.bank_foreign_amount > 0 ? notice.bank_foreign_amount : null;
  const cur = (notice.bank_foreign_currency ?? "").toUpperCase() || null;
  const fits = all.filter((c) => {
    if (date && days(date, c.expense_date) > 7) return false;
    if (foreign != null) return close(foreign, c.local_amount) && (!cur || cur === c.local_currency);
    if (bank) return Math.abs(bank.purchase - c.zar_amount) <= 0.15 * c.zar_amount;
    return true;
  });
  return fits.sort((a, b) => (date ? days(date, a.expense_date) - days(date, b.expense_date) : b.expense_date.localeCompare(a.expense_date)));
}

export function candidateLabel(c: CardCandidate): string {
  return `${c.vendor ?? c.description} · ${money(c.local_amount, c.local_currency)} · ${c.expense_date} · ${c.team_name}`;
}

export function cardConfirmValue(draftId: string, expenseId: string): string {
  return `${draftId}|${expenseId}`;
}

export function cardConfirmBlocks(args: {
  draftId: string;
  notice: ReceiptReading;
  candidates: CardCandidate[];
  cancelActionId: string;
}): unknown[] {
  const bank = bankAmounts(args.notice);
  const what = bank
    ? `*${money(bank.total, "ZAR")}*${bank.fee > 0 ? ` (incl. ${money(bank.fee, "ZAR")} fee)` : ""}`
    : "a card payment";
  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: `🏦 *Bank notification* for ${what} — which card payment is it for?` } },
  ];
  const cancel = {
    type: "button",
    action_id: args.cancelActionId,
    value: args.draftId,
    text: { type: "plain_text", text: "Not these" },
  };
  if (args.candidates.length === 1) {
    const c = args.candidates[0];
    blocks.push({ type: "section", text: { type: "mrkdwn", text: candidateLabel(c) } });
    blocks.push({
      type: "actions",
      block_id: `card_confirm:${args.draftId}`,
      elements: [
        {
          type: "button",
          style: "primary",
          action_id: ACTION_CARD_CONFIRM,
          value: cardConfirmValue(args.draftId, c.id),
          text: { type: "plain_text", text: "✅ Yes, confirm it" },
        },
        cancel,
      ],
    });
  } else {
    blocks.push({
      type: "actions",
      block_id: `card_confirm:${args.draftId}`,
      elements: [
        {
          type: "static_select",
          action_id: ACTION_CARD_CONFIRM,
          placeholder: { type: "plain_text", text: "Choose the payment" },
          options: args.candidates.slice(0, 25).map((c) => opt(candidateLabel(c), cardConfirmValue(args.draftId, c.id))),
          confirm: {
            title: { type: "plain_text", text: "Confirm this payment?" },
            text: { type: "plain_text", text: "Its rand amount will be replaced by the bank's." },
            confirm: { type: "plain_text", text: "Confirm" },
            deny: { type: "plain_text", text: "Back" },
          },
        },
        cancel,
      ],
    });
  }
  return blocks;
}

/** The morning reminder for one person. */
export function reminderText(items: { vendor: string | null; description: string; local_amount: number; local_currency: string; expense_date: string; team_name: string }[]): string {
  const shown = items.slice(0, 10);
  const lines = shown.map(
    (e) => `• ${e.vendor ?? e.description} — ${money(e.local_amount, e.local_currency)} (${e.expense_date}, ${e.team_name})`
  );
  const more = items.length > shown.length ? `\n…and ${items.length - shown.length} more.` : "";
  const n = items.length;
  return (
    `💳 ${n} card payment${n === 1 ? " is" : "s are"} still waiting for the bank notification, so ${n === 1 ? "its" : "their"} rand is an estimate:\n` +
    `${lines.join("\n")}${more}\n` +
    "Send me each bank notification screenshot and I'll record the real rand."
  );
}
