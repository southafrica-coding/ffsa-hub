/**
 * Turns a confirmed receipt into a Xero spend, then remembers the result
 * on the draft. Never called before confirm. A repayment never gets here
 * with hasReceipt, and decideXeroSpend refuses it anyway.
 *
 * The Xero id is stored on outreach_receipt_drafts.proposal.xero_write
 * (jsonb that already exists). A row is also written to budget_xero_spends
 * (Hub Data draft #513) once that table exists. The amount is cents of the
 * parent budget's currency. The line column is line_id. There is no
 * currency column and no org_key. It is not budget_expenses.
 */

import { xeroSpendLogRow } from "@/lib/finance/budget-log-rows";
import { isMissingRelation } from "@/lib/finance/budget-actuals";
import { isActiveSouthAfricaOrg } from "@/lib/finance/team-budget-pick";
import { xeroPreviewWriteBlock } from "@/lib/finance/xero-preview-guard";
import { decideXeroSpend, spendBankAccountCode, type XeroTracking } from "@/lib/finance/xero-spend";
import { createXeroSpendMoney, type XeroRegion } from "@/services/xero";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export type ConfirmedSpend = {
  draftId: string;
  expenseId: string | null;
  hubUserId: string | null;
  confirmed: boolean;
  hasReceipt: boolean;
  repayment: boolean;
  zarConfirmed: boolean;
  amountZar: number;
  date: string;
  description: string;
  vendor: string | null;
  budgetId: string | null;
  budgetLineId: string | null;
  /** npc when a ZAR budget was chosen. usa is ignored and does not open a dollar log. */
  orgKey: "npc" | "usa" | null;
  /** Parent budget currency. Only ZAR is logged. */
  currency: "ZAR" | "USD";
  /** Ignored for the post. Confirmed spends use the ZA region. */
  region: XeroRegion;
  paymentMethod: "cash" | "card" | "bank_transfer";
  budgetStatus: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  proposal: Record<string, unknown>;
};

type Coding = { accountCode: string | null; tracking: XeroTracking[]; incomplete: boolean };

async function loadCoding(admin: Admin, lineId: string | null, region: XeroRegion): Promise<Coding> {
  if (!lineId) return { accountCode: null, tracking: [], incomplete: false };
  const { data, error } = await admin
    .from("budget_line_coding")
    .select("account_id, tracking_option_1_id, tracking_option_2_id")
    .eq("line_id", lineId)
    .eq("org_region", region)
    .maybeSingle();
  if (error || !data) return { accountCode: null, tracking: [], incomplete: false };

  const optionIds = [data.tracking_option_1_id, data.tracking_option_2_id].filter(
    (id: unknown): id is string => typeof id === "string" && id.length > 0
  );
  const accountQuery = data.account_id
    ? admin.from("xero_accounts").select("code, status").eq("id", data.account_id).maybeSingle()
    : Promise.resolve({ data: null });
  const optionQuery = optionIds.length
    ? admin.from("xero_tracking_options").select("id, name, category_id").in("id", optionIds)
    : Promise.resolve({ data: [] as { id: string; name: string; category_id: string }[] });
  const [{ data: account }, { data: options, error: optionError }] = await Promise.all([accountQuery, optionQuery]);
  const accountCode =
    account && String(account.status).toLowerCase() === "active" && typeof account.code === "string" && account.code.trim() ? account.code.trim() : null;
  if (optionError || (options ?? []).length !== optionIds.length) {
    return { accountCode, tracking: [], incomplete: optionIds.length > 0 };
  }
  const catIds = [...new Set((options ?? []).map((o: { category_id: string }) => o.category_id))];
  const { data: cats } = catIds.length
    ? await admin.from("xero_tracking_categories").select("id, name").in("id", catIds)
    : { data: [] as { id: string; name: string }[] };
  const catName = new Map((cats ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));
  const tracking = (options ?? [])
    .map((o: { name: string; category_id: string }) => ({ name: catName.get(o.category_id) ?? "", option: o.name }))
    .filter((t: XeroTracking) => t.name && t.option);
  if (tracking.length !== optionIds.length) return { accountCode, tracking: [], incomplete: true };
  return { accountCode, tracking, incomplete: false };
}

function inBudgetPeriod(date: string, start: string | null, end: string | null): boolean {
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return date >= start.slice(0, 10) && date <= end.slice(0, 10);
}

/** An existing Xero bank transaction for this expense, from the log or a draft. */
async function xeroIdForExpense(admin: Admin, expenseId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("budget_xero_spends")
    .select("xero_bank_transaction_id")
    .eq("outreach_expense_id", expenseId)
    .limit(5);
  if (!error) {
    const hit = ((data ?? []) as { xero_bank_transaction_id?: string | null }[]).find((row) => row.xero_bank_transaction_id);
    if (hit?.xero_bank_transaction_id) return hit.xero_bank_transaction_id;
  }
  const { data: drafts, error: draftError } = await admin
    .from("outreach_receipt_drafts")
    .select("proposal")
    .eq("expense_id", expenseId);
  if (draftError) {
    console.error("[xero] could not read drafts for expense", expenseId, draftError.message ?? draftError);
    return null;
  }
  for (const row of (drafts ?? []) as { proposal?: { xero_write?: { bank_transaction_id?: string | null } } }[]) {
    const id = row.proposal?.xero_write?.bank_transaction_id;
    if (typeof id === "string" && id) return id;
  }
  return null;
}

/** Merges xero_write into the draft as it is now. A stored bank id is not replaced. */
async function saveXeroOnDraft(
  admin: Admin,
  draftId: string,
  xeroWrite: { status: string; bank_transaction_id: string | null; error: string | null; at: string }
): Promise<{ ok: boolean; message?: string }> {
  const { data, error: readError } = await admin
    .from("outreach_receipt_drafts")
    .select("proposal")
    .eq("id", draftId)
    .maybeSingle();
  if (readError) return { ok: false, message: readError.message ?? "could not read the draft" };
  const current = ((data?.proposal ?? {}) as Record<string, unknown>) ?? {};
  const prior = current.xero_write as { bank_transaction_id?: string | null; status?: string } | undefined;
  const bankTransactionId = prior?.bank_transaction_id || xeroWrite.bank_transaction_id;
  const proposal = {
    ...current,
    xero_write: {
      ...xeroWrite,
      bank_transaction_id: bankTransactionId,
      status: prior?.bank_transaction_id ? prior.status ?? "written" : xeroWrite.status,
    },
  };
  const { error } = await admin
    .from("outreach_receipt_drafts")
    .update({ proposal, updated_at: new Date().toISOString() })
    .eq("id", draftId);
  if (error) return { ok: false, message: error.message ?? "could not store the Xero id" };
  return { ok: true };
}

/** Active FFSA NPC in ZAR, or the budget cannot be the parent of a spend. */
async function budgetOrgState(admin: Admin, budgetId: string): Promise<"yes" | "no" | "missing"> {
  const budget = await admin.from("budgets").select("org_id, currency").eq("id", budgetId).maybeSingle();
  if (budget.error) return isMissingRelation(budget.error) ? "missing" : "no";
  const orgId = budget.data?.org_id as string | null | undefined;
  if (!orgId || (budget.data?.currency ?? "").toUpperCase() !== "ZAR") return "no";
  const org = await admin.from("finance_orgs").select("key, is_active, record_currency").eq("id", orgId).maybeSingle();
  if (org.error) return isMissingRelation(org.error) ? "missing" : "no";
  return isActiveSouthAfricaOrg(org.data) ? "yes" : "no";
}

/** The receipt/Xero log (#513). Not budget_expenses. One row per expense or draft. */
async function rememberXeroSpend(
  admin: Admin,
  input: ConfirmedSpend,
  status: string,
  bankTransactionId: string | null
) {
  // Parent books are ZAR. A USA org key does not open a dollar log.
  const budgetCurrency = input.orgKey === "npc" && input.currency === "ZAR" ? "ZAR" : null;
  const row = xeroSpendLogRow({
    budgetId: input.budgetId,
    lineId: input.budgetLineId,
    outreachExpenseId: input.expenseId,
    receiptDraftId: input.draftId,
    purchaserUserId: input.hubUserId,
    bookAmount: input.amountZar,
    bookCurrency: input.currency,
    budgetCurrency,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    spentOn: input.date,
    description: input.description,
    hasReceipt: input.hasReceipt,
    xeroBankTransactionId: bankTransactionId,
    xeroStatus: status,
    confirmedAt: new Date().toISOString(),
  });
  if (!row) return;
  const byExpense = input.expenseId
    ? await admin.from("budget_xero_spends").select("id").eq("outreach_expense_id", input.expenseId).limit(1)
    : { data: [], error: null };
  if (byExpense.error) {
    if (!isMissingRelation(byExpense.error)) {
      console.error("[xero] budget_xero_spends read failed", input.draftId, byExpense.error.message ?? byExpense.error);
    }
    return;
  }
  let prior = (byExpense.data ?? []) as { id: string }[];
  if (!prior.length) {
    const byDraft = await admin.from("budget_xero_spends").select("id").eq("receipt_draft_id", input.draftId).limit(1);
    if (byDraft.error) {
      if (!isMissingRelation(byDraft.error)) {
        console.error("[xero] budget_xero_spends read failed", input.draftId, byDraft.error.message ?? byDraft.error);
      }
      return;
    }
    prior = (byDraft.data ?? []) as { id: string }[];
  }
  const { error } = prior.length
    ? await admin.from("budget_xero_spends").update(row).eq("id", prior[0].id)
    : await admin.from("budget_xero_spends").insert(row);
  // A second session can insert the same draft or bank id first. The unique
  // key already kept one row, so this attempt is the same confirm.
  if (error && isUniqueViolation(error)) return false;
  if (error && !isMissingRelation(error)) {
    console.error("[xero] budget_xero_spends write failed", input.draftId, error.message ?? error);
    return false;
  }
  return true;
}

function isUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "23505" || /duplicate key|unique constraint/i.test(error.message ?? "");
}

/**
 * One poster per receipt draft. The insert is the claim. A second confirm
 * sees that row and does not call Xero. A failed attempt can be taken over.
 * The Idempotency-Key stays ffsa-expense-<expenseId> for the call that does post.
 */
async function claimSpend(admin: Admin, input: ConfirmedSpend): Promise<"mine" | "busy" | "skip"> {
  const row = xeroSpendLogRow({
    budgetId: input.budgetId,
    lineId: input.budgetLineId,
    outreachExpenseId: input.expenseId,
    receiptDraftId: input.draftId,
    purchaserUserId: input.hubUserId,
    bookAmount: input.amountZar,
    bookCurrency: input.currency,
    budgetCurrency: input.orgKey === "npc" && input.currency === "ZAR" ? "ZAR" : null,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    spentOn: input.date,
    description: input.description,
    hasReceipt: input.hasReceipt,
    xeroBankTransactionId: null,
    xeroStatus: "posting",
    confirmedAt: new Date().toISOString(),
  });
  if (!row) return "skip";
  const inserted = await admin.from("budget_xero_spends").insert(row).select("id");
  if (!inserted.error) return "mine";
  if (!isUniqueViolation(inserted.error)) {
    console.error("[xero] spend claim failed", input.draftId, inserted.error.message ?? inserted.error);
    return "skip";
  }
  const existing = await admin
    .from("budget_xero_spends")
    .select("id, xero_bank_transaction_id, xero_status")
    .eq("receipt_draft_id", input.draftId)
    .maybeSingle();
  const held = existing.data as { id?: string; xero_bank_transaction_id?: string | null; xero_status?: string } | null;
  if (!held?.id) return "busy";
  if (held.xero_bank_transaction_id) return "busy";
  if (held.xero_status !== "failed") return "busy";
  const taken = await admin
    .from("budget_xero_spends")
    .update({ xero_status: "posting" })
    .eq("id", held.id)
    .eq("xero_status", "failed")
    .select("id");
  const takenRows = Array.isArray(taken.data) ? taken.data : taken.data ? [taken.data] : [];
  if (taken.error || takenRows.length === 0) return "busy";
  return "mine";
}

/**
 * Writes to Xero only when decideXeroSpend says so. Saves the outcome on
 * the draft either way, so a retry can see the bank transaction id and
 * not post a second time.
 */
export async function writeConfirmedSpend(
  admin: Admin,
  input: ConfirmedSpend
): Promise<{ status: string; bankTransactionId: string | null }> {
  if (xeroPreviewWriteBlock()) {
    return { status: "preview_blocked", bankTransactionId: null };
  }

  if (input.expenseId) {
    const already = await xeroIdForExpense(admin, input.expenseId);
    if (already) {
      // The spend was already sent. A lost log row is written now, without another post.
      await rememberXeroSpend(admin, input, "written", already);
      return { status: "already_written", bankTransactionId: already };
    }
  }

  if (input.budgetId) {
    const org = await budgetOrgState(admin, input.budgetId);
    if (org !== "yes") {
      const status = org === "missing" ? "schema_not_applied" : "org_not_south_africa";
      const saved = await saveXeroOnDraft(admin, input.draftId, {
        status,
        bank_transaction_id: null,
        error: null,
        at: new Date().toISOString(),
      });
      if (!saved.ok) console.error("[xero] draft did not store the org refusal", input.draftId, saved.message);
      return { status, bankTransactionId: null };
    }
  }

  // Confirmed spends use the ZA bank path. A stored "usa" proposal does not switch region.
  const region = "za" as const;
  const coding = await loadCoding(admin, input.budgetLineId, region);
  let status = "failed";
  let bankTransactionId: string | null = null;
  let error: string | null = null;

  const hasLine = Boolean(input.budgetLineId);
  const approved = input.budgetStatus === "approved";
  const dated = inBudgetPeriod(input.date, input.periodStart, input.periodEnd);

  if (input.paymentMethod === "cash") {
    status = "cash_not_posted";
  } else if (hasLine && !approved) {
    status = "unapproved_budget";
  } else if (hasLine && !dated) {
    status = "outside_period";
  } else if (coding.incomplete) {
    error = "The budget line's tracking options could not be read, so nothing was sent to Xero.";
  } else if (!input.expenseId) {
    error = "There is no expense to attach this Xero spend to.";
  } else {
    const decision = decideXeroSpend({
      confirmed: input.confirmed,
      hasReceipt: input.hasReceipt,
      repayment: input.repayment,
      zarConfirmed: input.zarConfirmed,
      paymentMethod: input.paymentMethod,
      amountZar: input.amountZar,
      date: input.date,
      description: input.description,
      vendor: input.vendor,
      reference: `ffsa-expense-${input.expenseId}`,
      accountCode: coding.accountCode,
      bankAccountCode: spendBankAccountCode(region),
      tracking: coding.tracking,
    });
    if (!decision.write) {
      status = decision.status;
    } else {
      const claim = await claimSpend(admin, input);
      if (claim !== "mine") {
        const held = input.expenseId ? await xeroIdForExpense(admin, input.expenseId) : null;
        if (held) {
          await rememberXeroSpend(admin, input, "written", held);
          return { status: "already_written", bankTransactionId: held };
        }
        return { status: claim === "busy" ? "in_flight" : "failed", bankTransactionId: null };
      }
      const posted = await createXeroSpendMoney(admin, region, {
        idempotencyKey: `ffsa-expense-${input.expenseId}`,
        payload: decision.payload,
      });
      if (posted.ok) {
        status = "written";
        bankTransactionId = posted.bankTransactionId;
      } else {
        status = "failed";
        error = posted.message;
        console.error("[xero] spend not written", input.expenseId, posted.message);
      }
    }
  }

  const saved = await saveXeroOnDraft(admin, input.draftId, {
    status,
    bank_transaction_id: bankTransactionId,
    error,
    at: new Date().toISOString(),
  });
  if (!saved.ok) {
    console.error("[xero] draft did not store the Xero id", input.draftId, saved.message);
  }

  if (input.confirmed && input.hasReceipt && !input.repayment && input.paymentMethod !== "cash") {
    await rememberXeroSpend(admin, input, status, bankTransactionId);
  }
  return { status, bankTransactionId };
}
