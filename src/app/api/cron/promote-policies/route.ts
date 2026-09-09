import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayInSA } from "@/lib/users/profile-fields";

export const maxDuration = 60;

// GET /api/cron/promote-policies — runs on a Vercel cron schedule.
// Promotes each member's QUEUED successor health-insurance policy
// (next_health_insurance_*) into their live policy once the current one has
// lapsed, then clears the queued columns. Writing the health_insurance_* columns
// fires the existing history trigger, so "Policies on record" and every validity
// reader pick up the new policy automatically. Mirrors the auth + batch-drain
// shape of /api/cron/run-workflows.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // next_* columns aren't in the generated DB types yet, so use a loose handle
  // for the queries that touch them (matches the `(supabase as any)` pattern
  // used elsewhere for not-yet-generated columns).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;
  const today = todayInSA(); // YYYY-MM-DD, Africa/Johannesburg

  // Due = a successor is queued AND the current policy's expiry is strictly
  // before today (the expiry day itself still counts as valid, so we switch the
  // day after).
  const { data: due, error } = await db
    .from("users")
    .select(
      "id, next_health_insurance_provider, next_health_insurance_policy_number, next_health_insurance_expiry_date, next_health_insurance_no_expiry"
    )
    .not("next_health_insurance_provider", "is", null)
    .lt("health_insurance_expiry_date", today)
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let promoted = 0;
  let failed = 0;

  for (const u of (due ?? []) as Array<{
    id: string;
    next_health_insurance_provider: string | null;
    next_health_insurance_policy_number: string | null;
    next_health_insurance_expiry_date: string | null;
    next_health_insurance_no_expiry: boolean | null;
  }>) {
    // A promoted open-ended policy carries no date and starts its annual
    // re-confirmation clock today; the two are mutually exclusive in the
    // database, so the flag has to travel with the write.
    const noExpiry = u.next_health_insurance_no_expiry === true;
    const { error: updErr } = await db
      .from("users")
      .update({
        health_insurance_provider: u.next_health_insurance_provider,
        health_insurance_policy_number: u.next_health_insurance_policy_number,
        health_insurance_expiry_date: noExpiry
          ? null
          : u.next_health_insurance_expiry_date,
        health_insurance_no_expiry: noExpiry,
        health_insurance_confirmed_at: noExpiry ? today : null,
        next_health_insurance_provider: null,
        next_health_insurance_policy_number: null,
        next_health_insurance_expiry_date: null,
        next_health_insurance_no_expiry: false,
      })
      .eq("id", u.id);
    if (updErr) failed += 1;
    else promoted += 1;
  }

  return NextResponse.json({ promoted, failed });
}
