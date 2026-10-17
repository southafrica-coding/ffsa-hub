/**
 * Money in hand: how much of the money SENT to an outreach team is still
 * with them. School leaders at base watch this to know when to send more.
 *
 *   sent  = fund releases to the team (ZAR)
 *   spent = expenses the team paid out of that money — cash, card or bank
 *           transfer. Prepayments (base paid directly, e.g. flights) and
 *           reimbursements (someone's own pocket) never came out of it.
 *   left  = sent − spent
 *
 * Levels drive the colour and the Slack alert to school leaders: "low" at
 * or under lowPct left (default 30%), "critical" at or under criticalPct
 * (default 15%) or overspent, "none" before any money has been sent.
 */

export const TEAM_CASH_METHODS = new Set(["cash", "card", "bank_transfer"]);

export type CashLevel = "none" | "ok" | "low" | "critical";

export const DEFAULT_LOW_PCT = 30;
export const DEFAULT_CRITICAL_PCT = 15;

export type CashExpense = { zar_amount: number | string; payment_method?: string | null; expense_date?: string };

/** Spending that came out of the money sent to the team. */
export function spentFromSent(expenses: CashExpense[]): number {
  return round(
    expenses
      .filter((e) => TEAM_CASH_METHODS.has(e.payment_method ?? "cash"))
      .reduce((s, e) => s + Number(e.zar_amount), 0)
  );
}

export function cashInHand(args: {
  sent: number;
  spent: number;
  lowPct?: number | null;
  criticalPct?: number | null;
}) {
  const sent = round(args.sent);
  const spent = round(args.spent);
  const left = round(sent - spent);
  const low = args.lowPct ?? DEFAULT_LOW_PCT;
  const critical = args.criticalPct ?? DEFAULT_CRITICAL_PCT;
  if (sent <= 0) return { sent, spent, left, pctLeft: null as number | null, pctSpent: null as number | null, level: "none" as CashLevel };
  const pctLeft = (left / sent) * 100;
  const level: CashLevel = pctLeft <= critical ? "critical" : pctLeft <= low ? "low" : "ok";
  return { sent, spent, left, pctLeft, pctSpent: 100 - pctLeft, level };
}

/** Average spend per day over the last `days` days (today included), from money sent. */
export function recentDailySpend(expenses: CashExpense[], today: string, days = 7): number {
  const from = shiftDate(today, -(days - 1));
  const total = expenses
    .filter((e) => TEAM_CASH_METHODS.has(e.payment_method ?? "cash"))
    .filter((e) => e.expense_date && e.expense_date >= from && e.expense_date <= today)
    .reduce((s, e) => s + Number(e.zar_amount), 0);
  return total > 0 ? total / days : 0;
}

/** Whole days the money left lasts at `perDay`; null when it can't be said. */
export function daysLeft(left: number, perDay: number): number | null {
  if (perDay <= 0 || left <= 0) return left <= 0 ? 0 : null;
  return Math.floor(left / perDay);
}

const RANK: Record<CashLevel, number> = { none: 0, ok: 1, low: 2, critical: 3 };

/** Should crossing from `prev` to `now` alert school leaders? Once per level, worse only. */
export function alertToSend(prev: CashLevel | null | undefined, now: CashLevel): "low" | "critical" | null {
  if (now !== "low" && now !== "critical") return null;
  return RANK[now] > RANK[prev ?? "none"] ? now : null;
}

export function shiftDate(iso: string, days: number): string {
  return new Date(new Date(iso + "T00:00:00Z").getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

const round = (n: number) => Math.round(n * 100) / 100;
