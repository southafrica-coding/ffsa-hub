import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/finance/outreach/cash-batches/proof?id=<pull> — opens the bank
 * notification screenshot kept with a cash pull (migration 263/264).
 *
 * The pull is read through RLS, so only its team's leaders and finance
 * staff get here; the file is then signed with the service role, like
 * receipts, because a screenshot filed from Slack has no uploader.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // Generated types predate proof_path (migration 263).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pull } = await (supabase as any).from("outreach_cash_batches").select("proof_path").eq("id", id).maybeSingle();
  if (!pull?.proof_path) return NextResponse.json({ error: "No screenshot for this cash pull" }, { status: 404 });

  const { data } = await createAdminClient().storage.from("outreach-receipts").createSignedUrl(pull.proof_path, 600);
  if (!data?.signedUrl) return NextResponse.json({ error: "Couldn't open the screenshot" }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
