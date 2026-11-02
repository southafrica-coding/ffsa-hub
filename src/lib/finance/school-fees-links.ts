import { redirect } from "next/navigation";
import { getFinanceHubAccess } from "@/lib/finance-access";

// Who may open the School Fees pages, and the "into Finance" links on a
// school's Fees panel. Both use the Finance hub's full-finance check
// (finance.view, or a finance-manage role/grant) — Jack's ruling, 2026-11-01.
// The Finance Office role (finance.donor_statements only) is not enough: it
// reaches donor statements, not student billing.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type FinanceLink = { href: string; label: string; primary: boolean };

export function schoolFeesFinanceLinks(programId: string): FinanceLink[] {
  return [
    { href: `/finance/school-fees/${programId}/students`, label: "Student billing in Finance", primary: true },
    { href: "/finance/school-fees", label: "Invoice run", primary: false },
    { href: `/finance/school-fees/${programId}/billing`, label: "All fee settings in Finance", primary: false },
  ];
}

/** True when the Finance hub would show this person full finance. */
export async function canSeeSchoolFeesFinanceLinks(
  supabase: Client,
  userId: string | null | undefined
): Promise<boolean> {
  if (!userId) return false;
  return (await getFinanceHubAccess(supabase, userId)).fullFinance;
}

/** Page gate for /finance/school-fees/**: anyone without full finance goes to /dashboard. */
export async function requireSchoolFeesAccess(supabase: Client, userId: string): Promise<void> {
  if (!(await canSeeSchoolFeesFinanceLinks(supabase, userId))) redirect("/dashboard");
}
