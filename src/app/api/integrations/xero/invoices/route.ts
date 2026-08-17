import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance } from "@/lib/api-auth";
import { listXeroInvoices, type XeroRegion } from "@/services/xero";

/**
 * What Xero already knows: invoices, what has been paid, what is outstanding.
 *
 * Read-only. The Hub is the source of truth for schedules; Xero is the source
 * of truth for payments, so this is how the Hub finds out what actually
 * happened rather than what it planned.
 *
 *   ?region=za|us   which organisation (defaults to both)
 *   ?contains=      filter on contact name / reference / invoice number
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!(await canManageFinance(supabase, user.id))) {
    return NextResponse.json(
      { error: "You don't have permission to view finance data" },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const contains = url.searchParams.get("contains") ?? undefined;
  const asked = url.searchParams.get("region") as XeroRegion | null;
  const regions: XeroRegion[] = asked ? [asked] : ["za", "us"];

  // One org failing (usually a lapsed authorisation) must not hide the other.
  const results = await Promise.all(
    regions.map(async (region) => {
      const { data, error } = await listXeroInvoices(supabase, region, { contains });
      return { region, data, error };
    })
  );

  return NextResponse.json({ results });
}
