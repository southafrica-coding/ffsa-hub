/**
 * Turns a confirmed receipt into a Xero spend, then remembers the result
 * on the draft. Never called before confirm. A repayment never gets here
 * with hasReceipt, and decideXeroSpend refuses it anyway.
 *
 * The Xero id is stored on outreach_receipt_drafts.proposal.xero_write
 * (jsonb that already exists). A budget_expenses row is inserted only when
 * Hub Data has created that table.
 */

import { isMissingRelation } from "@/lib/finance/budget-actuals";
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
  region: XeroRegion;
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

async function rememberBudgetExpense(
  admin: Admin,
  input: ConfirmedSpend,
  status: string,
  bankTransactionId: string | null
) {
  const { error } = await admin.from("budget_expenses").insert({
    budget_id: input.budgetId,
    budget_line_id: input.budgetLineId,
    outreach_expense_id: input.expenseId,
    receipt_draft_id: input.draftId,
    purchaser_user_id: input.hubUserId,
    amount_cents: Math.round(input.amountZar * 100),
    currency: "ZAR",
    spent_on: input.date,
    description: input.description,
    has_receipt: true,
    xero_bank_transaction_id: bankTransactionId,
    xero_status: status,
    confirmed_at: new Date().toISOString(),
  });
  if (error && !isMissingRelation(error)) {
    console.error("[xero] budget_expenses insert failed", input.draftId, error.message ?? error);
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
  const existing = input.proposal.xero_write as { bank_transaction_id?: string | null } | null | undefined;
  if (existing?.bank_transaction_id) {
    return { status: "already_written", bankTransactionId: existing.bank_transaction_id };
  }

  const coding = await loadCoding(admin, input.budgetLineId, input.region);
  let status = "failed";
  let bankTransactionId: string | null = null;
  let error: string | null = null;

  if (coding.incomplete) {
    error = "The budget line's tracking options could not be read, so nothing was sent to Xero.";
  } else {
    const decision = decideXeroSpend({
      confirmed: input.confirmed,
      hasReceipt: input.hasReceipt,
      repayment: input.repayment,
      zarConfirmed: input.zarConfirmed,
      amountZar: input.amountZar,
      date: input.date,
      description: input.description,
      vendor: input.vendor,
      reference: `ffsa-${input.draftId}`,
      accountCode: coding.accountCode,
      bankAccountCode: spendBankAccountCode(input.region),
      tracking: coding.tracking,
    });
    if (!decision.write) {
      status = decision.status;
    } else {
      const posted = await createXeroSpendMoney(admin, input.region, {
        idempotencyKey: `ffsa-receipt-${input.draftId}`,
        payload: decision.payload,
      });
      if (posted.ok) {
        status = "written";
        bankTransactionId = posted.bankTransactionId;
      } else {
        status = "failed";
        error = posted.message;
        console.error("[xero] spend not written", input.draftId, posted.message);
      }
    }
  }

  const xero_write = { status, bank_transaction_id: bankTransactionId, error, at: new Date().toISOString() };
  await admin
    .from("outreach_receipt_drafts")
    .update({ proposal: { ...input.proposal, xero_write }, updated_at: new Date().toISOString() })
    .eq("id", input.draftId);

  if (input.confirmed && input.hasReceipt && !input.repayment) {
    await rememberBudgetExpense(admin, input, status, bankTransactionId);
  }
  return { status, bankTransactionId };
}
