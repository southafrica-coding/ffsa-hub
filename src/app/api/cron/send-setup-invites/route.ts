import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendSetupLink, resolveSiteUrl } from "@/lib/auth/send-setup-link";
import { userHasPassword } from "@/lib/auth/account-state";
import { accountSetupEmailHtml } from "@/lib/email/templates/account-setup";
import { todayIso } from "@/lib/schools/setup-invite-schedule";

export const maxDuration = 60;

// GET /api/cron/send-setup-invites — daily Vercel cron (06:00 UTC).
//
// Sends the HUB setup links that accept-application held back (migration
// 230): every user whose users.setup_invite_due_on has arrived gets a fresh
// 30-day /setup link. sendSetupLink → createOnboardingInvite clears the due
// date on success, so each person is emailed once. A failed send keeps the
// date and is retried the next day.
//
// Skipped and cleared (nothing to send): already has a password, account
// deactivated, or no longer on any school roster.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/** Leave headroom under maxDuration; anyone left over goes out tomorrow. */
const TIME_BUDGET_MS = 50_000;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const admin: Client = createAdminClient();
  const today = todayIso();

  const { data: due, error } = await admin
    .from("users")
    .select("id, email, first_name, is_active, setup_invite_due_on")
    .not("setup_invite_due_on", "is", null)
    .lte("setup_invite_due_on", today)
    .order("setup_invite_due_on", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = { due: due?.length ?? 0, sent: 0, skipped: 0, failed: 0, deferred: 0 };

  const clear = (userId: string) =>
    admin.from("users").update({ setup_invite_due_on: null }).eq("id", userId);

  for (const user of (due ?? []) as Array<{
    id: string;
    email: string | null;
    first_name: string | null;
    is_active: boolean | null;
  }>) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      result.deferred += 1;
      continue;
    }

    // The school they were accepted to — newest enrolment still on a roster.
    const { data: enrolment } = await admin
      .from("enrollments")
      .select("id, program_id, programs(name)")
      .eq("user_id", user.id)
      .is("removed_at", null)
      .order("enrolled_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (
      !user.email ||
      user.is_active === false ||
      !enrolment ||
      (await userHasPassword(admin, user.id))
    ) {
      await clear(user.id);
      result.skipped += 1;
      continue;
    }

    const program = Array.isArray(enrolment.programs)
      ? enrolment.programs[0]
      : enrolment.programs;
    const programName: string | null = program?.name ?? null;

    const send = await sendSetupLink(admin, {
      userId: user.id,
      email: user.email,
      firstName: user.first_name,
      subject: programName
        ? `Set up your FFSA Hub account for ${programName}`
        : "Set up your FFSA Hub account",
      html: (setupUrl) =>
        accountSetupEmailHtml({
          firstName: user.first_name || undefined,
          setupUrl,
          siteUrl: resolveSiteUrl(),
          programName,
        }),
      category: "account_setup_link",
      sourceType: "enrollment",
      sourceId: enrolment.id,
      programDocumentsFor: enrolment.program_id,
      reason: programName
        ? `They were accepted to ${programName}, which starts soon.`
        : "They were accepted to a school that starts soon.",
    });

    if (send.ok) {
      await admin
        .from("users")
        .update({ invited_at: new Date().toISOString() })
        .eq("id", user.id);
      result.sent += 1;
    } else if (send.suppressed) {
      // The address bounces, so retrying daily can never work. Clear it; the
      // Users page already flags "Email bouncing" → Copy setup link.
      await clear(user.id);
      result.failed += 1;
    } else {
      console.error("[send-setup-invites] send failed", user.id, send.error);
      result.failed += 1;
    }
  }

  return NextResponse.json(result);
}
