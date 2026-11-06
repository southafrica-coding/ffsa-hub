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
  /** npc or usa, when a budget was chosen. Null when the receipt is not on one yet. */
  orgKey: "npc" | "usa" | null;
  /** Book currency of that org: ZAR for NPC, USD for USA. */
  currency: "ZAR" | "USD";
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
    account && account.status === "ACTIVE" && typeof account.code === "string" && account.code.trim() ? account.code.trim() : null;
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

/** The receipt/Xero log (#513). Not budget_expenses. One row per expense or draft. */
async function rememberXeroSpend(
  admin: Admin,
  input: ConfirmedSpend,
  status: string,
  bankTransactionId: string | null
) {
  const budgetCurrency = input.orgKey === "usa" ? "USD" : input.orgKey === "npc" ? "ZAR" : null;
  const row = xeroSpendLogRow({
    budgetId: input.budgetId,
    lineId: input.budgetLineId,
    outreachExpenseId: input.expenseId,
    receiptDraftId: input.draftId,
    purchaserUserId: input.hubUserId,
    bookAmount: input.amountZar,
    bookCurrency: input.currency,
    budgetCurrency,
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
  if (error && !isMissingRelation(error)) {
    console.error("[xero] budget_xero_spends write failed", input.draftId, error.message ?? error);
  }
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
    if (already) return { status: "already_written", bankTransactionId: already };
  }

  const coding = await loadCoding(admin, input.budgetLineId, input.region);
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
      bankAccountCode: spendBankAccountCode(input.region),
      tracking: coding.tracking,
    });
    if (!decision.write) {
      status = decision.status;
    } else {
      const posted = await createXeroSpendMoney(admin, input.region, {
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
