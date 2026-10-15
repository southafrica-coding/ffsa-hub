// ────────────────────────────────────────────────────────────
// FFSA Hub — matching a student's existing Xero invoices to their Hub charges
// ────────────────────────────────────────────────────────────
// Schools that move onto Hub billing mid-year have already invoiced some
// charges by hand in Xero. Before the Hub invoices anything, each student's
// Xero invoices are matched to their Hub charges so those charges are linked
// (and their payments read back) instead of invoiced a second time.
//
// The rules:
//   - A Xero line matches a Hub charge by ITEM CODE, never by name.
//   - When a code repeats (monthly tuition), the charge whose due date is
//     closest to the invoice's due date wins.
//   - Only charges not yet invoiced are candidates; an invoice already linked
//     to a charge is skipped.
//   - A line for the school but another tier (DEP-B against a tier A plan) is
//     reported as a tier mismatch, never matched.
//   - A school line with no charge left to take it is reported, not dropped.
//   - Anything else (merch, drives…) isn't the school's and is ignored.
//
// Pure, so the rules are tested directly.
// ────────────────────────────────────────────────────────────

export interface MatchCharge {
  id: string;
  label: string;
  xero_item_code: string | null;
  amount_zar: number;
  due_date: string;
  status: string;
  xero_invoice_id: string | null;
}

export interface MatchInvoice {
  invoiceId: string;
  invoiceNumber: string | null;
  status: string;
  dueDate: string | null;
  date: string | null;
  amountPaid: number;
  amountDue: number;
  lines: Array<{ itemCode: string | null; description: string; amount: number }>;
}

export interface ProposedLink {
  chargeId: string;
  chargeLabel: string;
  chargeDueDate: string;
  chargeAmount: number;
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceStatus: string;
  invoiceDueDate: string | null;
  invoiceAmountPaid: number;
  invoiceAmountDue: number;
  itemCode: string;
  lineAmount: number;
  amountDiffers: boolean;
}

export interface UnmatchedLine {
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceStatus: string;
  itemCode: string;
  amount: number;
  reason: "tier_mismatch" | "no_charge_left";
  invoicedTier?: string;
}

export interface StudentMatch {
  links: ProposedLink[];
  unmatched: UnmatchedLine[];
  /** The tier the school lines were invoiced at, when it isn't the plan's. */
  suggestedTier: string | null;
  /** Invoices already linked to Hub charges (nothing to do). */
  alreadyLinked: number;
  /** Non-school invoices (other item codes) left alone. */
  otherInvoices: number;
}

/** Charges the Hub hasn't invoiced yet — the only ones a Xero invoice can take. */
export const LINKABLE = new Set(["scheduled", "needs_decision"]);

const TIER_RE = /^(.*)-([ABC])$/i;

/** "FFXYL2027-DEP-B" → { base: "FFXYL2027-DEP", tier: "B" }. */
export function splitTier(code: string): { base: string; tier: string | null } {
  const m = code.trim().toUpperCase().match(TIER_RE);
  return m ? { base: m[1], tier: m[2] } : { base: code.trim().toUpperCase(), tier: null };
}

const days = (a: string, b: string) =>
  Math.abs(Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b.slice(0, 10)}T00:00:00Z`)) / 864e5;

export function matchStudentInvoices(
  charges: MatchCharge[],
  invoices: MatchInvoice[],
  opts: {
    /** Every item code the school bills, across all tiers and courses. */
    schoolCodes: Iterable<string>;
  }
): StudentMatch {
  const school = new Set([...opts.schoolCodes].map((c) => c.trim().toUpperCase()));
  const schoolBases = new Set([...school].map((c) => splitTier(c).base));
  const linkedIds = new Set(charges.map((c) => c.xero_invoice_id).filter(Boolean) as string[]);
  const free = charges.filter((c) => LINKABLE.has(c.status) && !c.xero_invoice_id && c.xero_item_code);
  const taken = new Set<string>();
  const planBases = new Map<string, string>(); // base → the plan's own code
  for (const c of charges) {
    if (c.xero_item_code) planBases.set(splitTier(c.xero_item_code).base, c.xero_item_code.toUpperCase());
  }

  const out: StudentMatch = { links: [], unmatched: [], suggestedTier: null, alreadyLinked: 0, otherInvoices: 0 };
  const mismatchTiers = new Set<string>();

  // Oldest invoices first, so repeated codes fill in date order.
  const ordered = [...invoices].sort((a, b) =>
    (a.dueDate ?? a.date ?? "") < (b.dueDate ?? b.date ?? "") ? -1 : 1
  );

  for (const inv of ordered) {
    if (inv.status === "VOIDED" || inv.status === "DELETED") continue;
    if (linkedIds.has(inv.invoiceId)) {
      out.alreadyLinked++;
      continue;
    }
    const lines = inv.lines.filter((l) => l.itemCode && (school.has(l.itemCode.toUpperCase()) || schoolBases.has(splitTier(l.itemCode).base)));
    if (lines.length === 0) {
      out.otherInvoices++;
      continue;
    }
    const target = inv.dueDate ?? inv.date ?? "";
    for (const line of lines) {
      const code = line.itemCode!.toUpperCase();
      const candidates = free.filter((c) => !taken.has(c.id) && c.xero_item_code!.toUpperCase() === code);
      if (candidates.length > 0) {
        const best = candidates.reduce((a, b) => {
          if (!target) return a.due_date <= b.due_date ? a : b;
          const da = days(a.due_date, target);
          const db = days(b.due_date, target);
          return da < db || (da === db && a.due_date <= b.due_date) ? a : b;
        });
        taken.add(best.id);
        out.links.push({
          chargeId: best.id,
          chargeLabel: best.label,
          chargeDueDate: best.due_date,
          chargeAmount: best.amount_zar,
          invoiceId: inv.invoiceId,
          invoiceNumber: inv.invoiceNumber,
          invoiceStatus: inv.status,
          invoiceDueDate: inv.dueDate,
          invoiceAmountPaid: inv.amountPaid,
          invoiceAmountDue: inv.amountDue,
          itemCode: code,
          lineAmount: line.amount,
          amountDiffers: Math.abs(line.amount - best.amount_zar) > 0.009,
        });
        continue;
      }
      const { base, tier } = splitTier(code);
      const own = planBases.get(base);
      const isMismatch = !!own && own !== code && tier !== null;
      if (isMismatch) mismatchTiers.add(tier!);
      out.unmatched.push({
        invoiceId: inv.invoiceId,
        invoiceNumber: inv.invoiceNumber,
        invoiceStatus: inv.status,
        itemCode: code,
        amount: line.amount,
        reason: isMismatch ? "tier_mismatch" : "no_charge_left",
        ...(isMismatch ? { invoicedTier: tier! } : {}),
      });
    }
  }

  // Only suggest a switch when every mismatched line points the same way.
  if (mismatchTiers.size === 1) out.suggestedTier = [...mismatchTiers][0];
  return out;
}

/** The Hub status a linked charge takes from its Xero invoice's status. */
export function hubStatusForXero(xeroStatus: string): "generated" | "sent" {
  return xeroStatus === "DRAFT" || xeroStatus === "SUBMITTED" ? "generated" : "sent";
}
