import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  getProgramGroups,
  getCoursesWithBilling,
} from "@/services/school-billing";
import { getCountryTiers } from "@/services/school-fees";
import { Globe } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { CountryTiersDialog } from "../country-tiers-dialog";
import { BillingSetupClient } from "./billing-setup-client";

export default async function BillingSetupPage() {
  const supabase = await createClient();

  const [{ data: groups }, { data: courses }, { data: countryTiers }] =
    await Promise.all([
      getProgramGroups(supabase),
      getCoursesWithBilling(supabase),
      getCountryTiers(supabase),
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

      {/* Country tier backbone list */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Globe className="h-4 w-4" /> Country Tier List
              </h2>
              <p className="text-xs text-muted-foreground max-w-prose">
                The master list mapping every country to a financial tier
                (A/B/C). A student&apos;s tier is auto-assigned from their
                application&apos;s home country. Only finance managers can edit
                this list.
              </p>
            </div>
            <CountryTiersDialog
              initialTiers={
                (countryTiers ?? []) as Parameters<
                  typeof CountryTiersDialog
                >[0]["initialTiers"]
              }
            />
          </div>
        </CardContent>
      </Card>

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
