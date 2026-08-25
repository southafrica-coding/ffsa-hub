import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkDomain } from "@/lib/email/dns-checks";

export const maxDuration = 60;
// node:dns is not available on the edge runtime.
export const runtime = "nodejs";

/**
 * GET /api/cron/check-sending-domains — daily on a Vercel cron.
 *
 * Re-checks SPF, DKIM and DMARC for every domain the Hub sends from
 * (migration 188).
 *
 * DAILY, not hourly. Doc 11 §8 asks for hourly; this project is on Vercel
 * Hobby, where any sub-daily cron fails the whole production build — which
 * it did once already (PR #197). The domains page has a re-check button so
 * nobody waits a day to see a DNS change land.
 *
 * A DNS failure leaves the previous verdict alone and records the error.
 * Overwriting a known-good result with a false negative because a resolver
 * blinked is how a diagnostic becomes an outage.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // sending_domains is not in the generated types yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;

  const { data: domains, error } = await db
    .from("sending_domains")
    .select("id, domain, dkim_selector");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: { domain: string; spf: boolean; dkim: boolean; dmarc: boolean; error: string | null }[] = [];

  for (const d of (domains ?? []) as {
    id: string;
    domain: string;
    dkim_selector: string | null;
  }[]) {
    const check = await checkDomain(d.domain, d.dkim_selector);

    const patch: Record<string, unknown> = {
      last_checked_at: new Date().toISOString(),
      last_error: check.error,
      expected_records: check.expected,
      updated_at: new Date().toISOString(),
    };

    // Only write verdicts when the lookup actually succeeded.
    if (!check.error) {
      patch.spf_ok = check.spfOk;
      patch.dkim_ok = check.dkimOk;
      patch.dmarc_ok = check.dmarcOk;
    }

    await db.from("sending_domains").update(patch).eq("id", d.id);

    results.push({
      domain: d.domain,
      spf: check.spfOk,
      dkim: check.dkimOk,
      dmarc: check.dmarcOk,
      error: check.error,
    });
  }

  return NextResponse.json({ checked: results.length, results });
}
