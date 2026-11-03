// Shapes of the outreach rows the app reads, parsed tolerantly with zod:
// unknown columns are ignored and nullable ones may be missing, so a new
// column on the website can't break an installed app. Money columns are
// Postgres numerics, which PostgREST may send as strings.

import { z } from "zod";

const str = z.string().nullish().transform((v) => v ?? null);
const num = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v) => (v === null || v === undefined || v === "" ? null : Number(v)))
  .refine((v) => v === null || Number.isFinite(v), "not a number");

// my_outreach_teams() (migration 260): the teams you're on, no money.
export const myTeamRowSchema = z.object({
  membership_id: z.string(),
  role: z.string(),
  team_id: z.string(),
  team_name: z.string(),
  location: str,
  country: str,
  status: z.string().nullish().transform((v) => v ?? "planning"),
  start_date: str,
  end_date: str,
  program_name: str,
});
export type MyTeamRow = z.infer<typeof myTeamRowSchema>;

// outreach_teams, read under RLS: only teams whose money you may see.
export const teamRowSchema = z.object({
  id: z.string(),
  team_name: z.string(),
  location: str,
  country: str,
  status: z.string().nullish().transform((v) => v ?? "planning"),
  currency: z.string().nullish().transform((v) => v ?? "ZAR"),
  start_date: str,
  end_date: str,
});
export type TeamRow = z.infer<typeof teamRowSchema>;

export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  sort_order: num,
});
export type Category = z.infer<typeof categorySchema>;

export const teamBudgetSchema = z.object({
  team_id: z.string(),
  category_id: z.string(),
  budget_amount_zar: num.transform((v) => v ?? 0),
});
export type TeamBudget = z.infer<typeof teamBudgetSchema>;

export const expenseSchema = z.object({
  id: z.string(),
  team_id: z.string(),
  category_id: z.string(),
  expense_date: z.string(),
  receipt_code: str,
  vendor: str,
  description: str,
  purchaser: str,
  payment_method: z.string().nullish().transform((v) => v ?? "cash"),
  country: str,
  local_currency: str,
  local_amount: num,
  zar_amount: num.transform((v) => v ?? 0),
  exchange_rate: num,
  receipt_path: str,
  notes: str,
  source: str,
  zar_confirmed: z.boolean().nullish().transform((v) => v ?? true),
});
export type Expense = z.infer<typeof expenseSchema>;

// Cash pulls: foreign cash is priced from these, oldest first (migration 263).
export const cashPullSchema = z.object({
  batch_date: z.string(),
  local_currency: str,
  exchange_rate: num,
});
export type CashPull = z.infer<typeof cashPullSchema>;

// outreach_team_overview() (migration 260): where, when and who's going.
export const overviewSchema = z.object({
  id: z.string(),
  team_name: z.string(),
  location: str,
  country: str,
  status: z.string().nullish().transform((v) => v ?? "planning"),
  start_date: str,
  end_date: str,
  program_name: str,
  my_role: str,
  roster: z
    .array(z.object({ id: z.string(), role: z.string(), name: str }))
    .nullish()
    .transform((v) => v ?? []),
});
export type TeamOverview = z.infer<typeof overviewSchema>;

// GET /api/finance/outreach/receipts?expense_id=…
export const receiptSchema = z.object({
  id: z.string(),
  expense_id: z.string(),
  file_path: z.string(),
  file_name: z.string(),
  file_size: num,
  mime_type: str,
  uploaded_at: str,
  signed_url: str,
});
export type Receipt = z.infer<typeof receiptSchema>;

export const LEADER_ROLES = ["owner", "co_leader"];
