import { NextResponse } from "next/server";
import { MISSIO_SLUG, requireOrgRole } from "@/lib/missio/access";
import { MISSIO_FINANCE_ROLES } from "@/lib/missio/finance/entry-input";
import { createAdminClient } from "@/lib/supabase/admin";
import { listMissioFinanceEntries } from "@/services/missio-finance";
import { listXeroBankReceipts, type XeroBankReceiptsResult } from "@/services/xero";
import { loadMissioFinance } from "@/lib/missio/finance/server";
import { DEFAULT_FROM_MONTH, isMonthKey, todayInSast } from "@/lib/missio/finance/report";

// GET /api/missio/finance?from=YYYY-MM
//
// Missio pastors only (org role, not an FFSA role). The income report from
// `from` (default July 2026) through today, SAST. Bank and SnapScan come from
// Xero, read-only; cash and FundraiseUp from missio_finance_entries.
// Only month totals are returned.

export const dynamic = "force-dynamic";

// Xero is read at most every few minutes per range, so a pastor refreshing
// the page doesn't spend the organisation's API allowance.
const XERO_TTL_MS = 5 * 60 * 1000;
const xeroCache = new Map<string, { at: number; result: XeroBankReceiptsResult }>();

export async function GET(request: Request) {
  const access = await requireOrgRole(MISSIO_SLUG, MISSIO_FINANCE_ROLES);
  if ("response" in access) return access.response;

  const today = todayInSast();
  const fromParam = new URL(request.url).searchParams.get("from");
  const fromMonth = fromParam ?? DEFAULT_FROM_MONTH;
  if (!isMonthKey(fromMonth) || fromMonth > today.slice(0, 7) || fromMonth < "2020-01") {
    return NextResponse.json({ error: "Check the fields and try again.", code: "invalid_input" }, { status: 400 });
  }

  const admin = createAdminClient();
  const body = await loadMissioFinance(
    {
      configuredAccountId: process.env.MISSIO_XERO_BANK_ACCOUNT_ID ?? null,
      listBankAccounts: async () =>
        await admin
          .from("xero_accounts")
          .select("xero_account_id, name, code")
          .eq("org_region", "za")
          .eq("is_bank", true)
          .eq("status", "active"),
      readReceipts: async (accountId, from, to) => {
        const key = `${accountId}|${from}|${to}`;
        const hit = xeroCache.get(key);
        if (hit && Date.now() - hit.at < XERO_TTL_MS) return hit.result;
        const result = await listXeroBankReceipts(admin, "za", { accountId, from, to });
        if (result.status === "ok") xeroCache.set(key, { at: Date.now(), result });
        return result;
      },
      listEntries: async (from, to) => await listMissioFinanceEntries(access.supabase, { orgId: access.orgId, fromMonth: from, toMonth: to }),
    },
    { fromMonth, today }
  );

  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
