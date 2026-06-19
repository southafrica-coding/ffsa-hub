import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  getProgramGroups,
  getCoursesWithBilling,
} from "@/services/school-billing";
import { BillingSetupClient } from "./billing-setup-client";

export default async function BillingSetupPage() {
  const supabase = await createClient();

  const [{ data: groups }, { data: courses }] = await Promise.all([
    getProgramGroups(supabase),
    getCoursesWithBilling(supabase),
  ]);

  // Charge items for all courses, grouped by program_id.
  // (new tables aren't in the generated DB types yet — cast like the rest of finance)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: chargeItems } = await (supabase as any)
    .from("fee_charge_items")
    .select("*")
    .order("tier", { ascending: true })
    .order("sort_order", { ascending: true });

  const itemsByProgram: Record<string, unknown[]> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const item of (chargeItems ?? []) as any[]) {
    (itemsByProgram[item.program_id] ??= []).push(item);
  }

  return (
    <div className="space-y-6">
      <Link
        href="/finance/school-fees"
        className="text-sm text-muted-foreground hover:underline"
      >
        &larr; Back to School Fees
      </Link>

      <div>
        <p className="page-eyebrow">FINANCIAL MANAGEMENT</p>
        <h1 className="page-title">Billing Setup</h1>
        <p className="text-sm text-muted-foreground">
          Configure programs, courses, and the charge items (deposit, monthly
          tuition, outreach, quarter payments) that drive invoice generation.
          Everything here is editable per course and tier.
        </p>
      </div>

      <BillingSetupClient
        groups={(groups ?? []) as Parameters<typeof BillingSetupClient>[0]["groups"]}
        courses={(courses ?? []) as Parameters<typeof BillingSetupClient>[0]["courses"]}
        itemsByProgram={
          itemsByProgram as Parameters<typeof BillingSetupClient>[0]["itemsByProgram"]
        }
      />
    </div>
  );
}
