// ────────────────────────────────────────────────────────────
// FFSA Hub — where a student stands with their school fees
// ────────────────────────────────────────────────────────────
// One definition of every number a fee progress bar shows, so the Finance
// list, the Training roster and the student page can't disagree. Pure; the
// caller passes "today" (South African date — see reference_server_client_today)
// because "overdue" depends on it.
//
// Segments always add up to the total:
//   paid            money Xero says arrived (synced from Xero, migration-free)
//   overdue         invoiced, unpaid, due date passed
//   invoicedNotDue  invoiced, unpaid, not due yet
//   notInvoiced     on the schedule but no invoice yet (incl. held charges)
// ────────────────────────────────────────────────────────────

export interface BalanceCharge {
  amount_zar: number | string;
  amount_paid_zar: number | string | null;
  status: string;
  due_date: string; // YYYY-MM-DD
}

export interface StudentBalance {
  total: number;
  paid: number;
  overdue: number;
  invoicedNotDue: number;
  notInvoiced: number;
  /** Remaining = total − paid. */
  outstanding: number;
  /** Charges held for a decision (late acceptance) — not yet invoiced. */
  heldCount: number;
  /** 0–100, one decimal. */
  percentPaid: number;
  /** The earliest charge still owing. */
  next: { dueDate: string; amount: number } | null;
}

const cents = (n: number) => Math.round(n * 100) / 100;
const INVOICED = new Set(["generated", "sent", "paid"]);

export function computeBalance(charges: BalanceCharge[], today: string): StudentBalance {
  let total = 0;
  let paid = 0;
  let overdue = 0;
  let invoicedNotDue = 0;
  let notInvoiced = 0;
  let heldCount = 0;
  let next: StudentBalance["next"] = null;

  for (const c of charges) {
    if (c.status === "cancelled") continue;
    const amount = cents(Number(c.amount_zar) || 0);
    // Never count more paid than the charge (an overpayment is Xero's to hold).
    const got = cents(Math.min(amount, Math.max(0, Number(c.amount_paid_zar) || 0)));
    const owing = cents(amount - got);
    total += amount;
    paid += got;

    if (INVOICED.has(c.status)) {
      if (owing > 0) {
        if (c.due_date < today) overdue += owing;
        else invoicedNotDue += owing;
      }
    } else {
      notInvoiced += owing;
      if (c.status === "needs_decision") heldCount++;
    }

    if (owing > 0 && (!next || c.due_date < next.dueDate)) {
      next = { dueDate: c.due_date, amount: owing };
    } else if (owing > 0 && next && c.due_date === next.dueDate) {
      next = { dueDate: next.dueDate, amount: cents(next.amount + owing) };
    }
  }

  total = cents(total);
  paid = cents(paid);
  return {
    total,
    paid,
    overdue: cents(overdue),
    invoicedNotDue: cents(invoicedNotDue),
    notInvoiced: cents(notInvoiced),
    outstanding: cents(total - paid),
    heldCount,
    percentPaid: total > 0 ? Math.floor((paid / total) * 1000) / 10 : 0,
    next,
  };
}

/** Add balances together (school totals). `next` is the earliest across them. */
export function sumBalances(list: StudentBalance[]): StudentBalance {
  const out = computeBalance([], "");
  for (const b of list) {
    out.total = cents(out.total + b.total);
    out.paid = cents(out.paid + b.paid);
    out.overdue = cents(out.overdue + b.overdue);
    out.invoicedNotDue = cents(out.invoicedNotDue + b.invoicedNotDue);
    out.notInvoiced = cents(out.notInvoiced + b.notInvoiced);
    out.heldCount += b.heldCount;
    if (b.next && (!out.next || b.next.dueDate < out.next.dueDate)) out.next = b.next;
  }
  out.outstanding = cents(out.total - out.paid);
  out.percentPaid = out.total > 0 ? Math.floor((out.paid / out.total) * 1000) / 10 : 0;
  return out;
}

/** Today's date in South Africa, YYYY-MM-DD — the Hub's users are SAST and
 *  Vercel renders in UTC, so "overdue" must not use the server's own date. */
export function todayInSouthAfrica(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}
