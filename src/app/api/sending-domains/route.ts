import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkDomain } from "@/lib/email/dns-checks";

export const runtime = "nodejs"; // node:dns

/**
 * Sending domains and their SPF / DKIM / DMARC state (migration 188).
 *
 * GET  — every domain, with the records still needing to be pasted into DNS.
 * POST — re-check one domain now, or set its DKIM selector.
 *
 * The re-check exists because the scheduled check is daily: doc 11 asks for
 * hourly, but Vercel Hobby only permits once-per-day crons. Nobody should
 * wait until tomorrow to find out whether the record they just added worked.
 *
 * Authorisation is RLS (migration 188): reading needs communications.view or
 * .send, writing needs communications.manage_brand_kits or admin.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("sending_domains")
    .select(
      "id, domain, spf_ok, dkim_ok, dmarc_ok, dkim_selector, last_checked_at, last_error, expected_records"
    )
    .order("domain");

  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

  return NextResponse.json({
    domains: data ?? [],
    // Said explicitly so the UI never implies a live reading.
    schedule: "daily",
    scheduleNote:
      "Checked once a day. Use Re-check after changing DNS rather than waiting.",
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const id = body?.id as string | undefined;
  const dkimSelector = body?.dkimSelector as string | undefined;

  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: domain, error: readError } = await db
    .from("sending_domains")
    .select("id, domain, dkim_selector")
    .eq("id", id)
    .single();

  if (readError || !domain) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }

  const selector =
    dkimSelector !== undefined ? dkimSelector.trim() || null : domain.dkim_selector;

  const check = await checkDomain(domain.domain, selector);

  const patch: Record<string, unknown> = {
    dkim_selector: selector,
    last_checked_at: new Date().toISOString(),
    last_error: check.error,
    expected_records: check.expected,
    updated_at: new Date().toISOString(),
  };
  if (!check.error) {
    patch.spf_ok = check.spfOk;
    patch.dkim_ok = check.dkimOk;
    patch.dmarc_ok = check.dmarcOk;
  }

  const { error: writeError } = await db
    .from("sending_domains")
    .update(patch)
    .eq("id", id);

  if (writeError) {
    return NextResponse.json({ error: writeError.message }, { status: 403 });
  }

  return NextResponse.json({ ok: true, domain: domain.domain, ...check });
}
