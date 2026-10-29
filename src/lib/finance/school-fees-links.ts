import { hasModuleAccess } from "@/lib/require-permission";

// The "into Finance" links on a school's Fees panel. Every destination runs
// requireModuleAccess(…, "finance"), so the links are shown to exactly the
// people that gate lets in: anyone else would only bounce to /dashboard.

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

/** Same rule as the destination pages' gate: the finance module, nothing wider. */
export async function canSeeSchoolFeesFinanceLinks(
  supabase: Client,
  userId: string | null | undefined
): Promise<boolean> {
  if (!userId) return false;
  return hasModuleAccess(supabase, userId, "finance");
}
