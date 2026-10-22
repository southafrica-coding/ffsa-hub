/**
 * Cash pulls (outreach_cash_batches), each priced on its own: what the
 * cash cost, the rate that gives, and how much of it is spent. The
 * charging of cash spending to pulls, oldest first, happens in the
 * database (reallocate_outreach_cash, migration 263); this only reads it.
 *
 *   zar_withdrawn  everything that left the account for the pull
 *   bank_fee       the part the bank showed as a fee (its own expense)
 *   cost           zar_withdrawn − bank_fee: what the cash itself cost
 */

export type PullRow = {
  id: string;
  batch_date: string;
  zar_withdrawn: number | string;
  bank_fee: number | string;
  local_currency: string | null;
  local_currency_received: number | string | null;
};

export type AllocationRow = {
  batch_id: string | null;
  local_currency: string;
  local_amount: number | string;
  zar_amount: number | string;
};

const cents = (n: number) => Math.round(n * 100) / 100;

/** What the cash cost and the rate that gives; null rate until both sides are in. */
export function pullPrice(args: { zarOut: number; fee: number; localReceived: number }) {
  const cost = cents(args.zarOut - args.fee);
  const ok = cost > 0 && args.localReceived > 0 && args.fee >= 0;
  return {
    cost,
    /** Local per rand — how the Hub stores rates. */
    localPerZar: ok ? args.localReceived / cost : null,
    /** Rand per unit of local — how people read them. */
    zarPerLocal: ok ? cost / args.localReceived : null,
  };
}

export type PullSummary = {
  id: string;
  cost: number;
  localReceived: number;
  localSpent: number;
  localLeft: number;
  zarSpent: number;
  zarLeft: number;
};

/** Per pull: how much of its cash (and its cost) has been spent, and what's left. */
export function summarisePulls(pulls: PullRow[], allocations: AllocationRow[]): PullSummary[] {
  const spent = new Map<string, { local: number; zar: number }>();
  for (const a of allocations) {
    if (!a.batch_id) continue;
    const s = spent.get(a.batch_id) ?? { local: 0, zar: 0 };
    s.local += Number(a.local_amount);
    s.zar += Number(a.zar_amount);
    spent.set(a.batch_id, s);
  }
  return pulls.map((p) => {
    const cost = cents(Number(p.zar_withdrawn) - Number(p.bank_fee));
    const localReceived = Number(p.local_currency_received ?? 0);
    const s = spent.get(p.id) ?? { local: 0, zar: 0 };
    return {
      id: p.id,
      cost,
      localReceived,
      localSpent: cents(s.local),
      localLeft: cents(localReceived - s.local),
      zarSpent: cents(s.zar),
      zarLeft: cents(cost - s.zar),
    };
  });
}

/** Cash spent that no pull covers, per currency — a pull is probably missing. */
export function uncoveredCash(allocations: AllocationRow[]): { currency: string; local: number; zar: number }[] {
  const by = new Map<string, { local: number; zar: number }>();
  for (const a of allocations) {
    if (a.batch_id) continue;
    const s = by.get(a.local_currency) ?? { local: 0, zar: 0 };
    s.local += Number(a.local_amount);
    s.zar += Number(a.zar_amount);
    by.set(a.local_currency, s);
  }
  return [...by.entries()]
    .map(([currency, s]) => ({ currency, local: cents(s.local), zar: cents(s.zar) }))
    .filter((u) => u.local > 0)
    .sort((a, b) => a.currency.localeCompare(b.currency));
}
