import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanManageApplications } from "@/lib/auth/check-schools-access";
import { sendTransactional } from "@/lib/email/send-transactional";
import { ffxTrackIntentEmailHtml } from "@/lib/email/templates/ffx-track-intent";

// One-off admin trigger for the FFX track-intent survey (migration 222).
// GET previews who it would email (dry run, no writes); POST actually
// creates the survey rows and sends. Both require schools-management
// access. Safe to re-run POST — already-sent recipients are skipped, and a
// survey row that exists but never got its email out (e.g. a prior partial
// failure) is reused rather than duplicated.
const FFX_PROGRAM_ID = "f839fd44-0051-4d47-ab8d-b548c5d32648";
const TARGET_STATUSES = ["accepted", "submitted"];

type Recipient = {
  applicationResponseId: string;
  status: string;
  email: string;
  firstName: string;
  alreadySent: boolean;
};

async function loadRecipients(admin: any): Promise<Recipient[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: responses } = await admin
    .from("application_responses")
    .select(
      "id, status, applicant_email, applicant_info, " +
        "users!application_responses_user_id_fkey(first_name, email)"
    )
    .eq("program_id", FFX_PROGRAM_ID)
    .in("status", TARGET_STATUSES);

  const { data: existingSurveys } = await admin
    .from("ffx_track_intent_surveys")
    .select("application_response_id, email_sent_at");
  const sentByResponseId = new Map<string, boolean>(
    (existingSurveys ?? []).map((s: any) => [ // eslint-disable-line @typescript-eslint/no-explicit-any
      s.application_response_id,
      !!s.email_sent_at,
    ])
  );

  return (responses ?? [])
    .map((r: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      applicationResponseId: r.id as string,
      status: r.status as string,
      email: (r.users?.email ?? r.applicant_email ?? r.applicant_info?.email ?? null) as
        | string
        | null,
      firstName: (r.users?.first_name ?? r.applicant_info?.first_name ?? "there") as string,
      alreadySent: sentByResponseId.get(r.id) ?? false,
    }))
    .filter((r: Recipient & { email: string | null }): r is Recipient => !!r.email);
}

async function requireAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  if (!(await userCanManageApplications(supabase, user.id))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  const access = await requireAccess();
  if (access.error) return access.error;

  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const recipients = await loadRecipients(admin);
  return NextResponse.json({
    count: recipients.length,
    pending: recipients.filter((r) => !r.alreadySent).length,
    recipients,
  });
}

export async function POST() {
  const access = await requireAccess();
  if (access.error) return access.error;

  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const recipients = await loadRecipients(admin);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ffsahub.com";

  const results: Array<{ email: string; outcome: "sent" | "skipped" | "failed"; detail?: string }> = [];

  for (const r of recipients) {
    if (r.alreadySent) {
      results.push({ email: r.email, outcome: "skipped", detail: "already sent" });
      continue;
    }

    const { data: existing } = await admin
      .from("ffx_track_intent_surveys")
      .select("id, token")
      .eq("application_response_id", r.applicationResponseId)
      .maybeSingle();

    let surveyId: string | undefined = existing?.id;
    let token: string | undefined = existing?.token;

    if (!surveyId) {
      const { data: created, error: insertError } = await admin
        .from("ffx_track_intent_surveys")
        .insert({ application_response_id: r.applicationResponseId, email: r.email })
        .select("id, token")
        .single();
      if (insertError || !created) {
        results.push({
          email: r.email,
          outcome: "failed",
          detail: insertError?.message ?? "insert failed",
        });
        continue;
      }
      surveyId = created.id;
      token = created.token;
    }

    const surveyUrl = `${siteUrl}/track-intent/${token}`;
    const sendResult = await sendTransactional({
      to: r.email,
      subject: "Which part of FFX 2027 are you doing?",
      html: ffxTrackIntentEmailHtml({ firstName: r.firstName, surveyUrl, siteUrl }),
      category: "ffx_track_intent_survey",
      sourceType: "application_responses",
      sourceId: r.applicationResponseId,
      reason:
        "One-off survey confirming whether they're doing FFX's whole programme or specific segments.",
    });

    if (!sendResult.ok) {
      results.push({ email: r.email, outcome: "failed", detail: sendResult.error });
      continue;
    }

    await admin
      .from("ffx_track_intent_surveys")
      .update({ email_sent_at: new Date().toISOString() })
      .eq("id", surveyId);

    results.push({ email: r.email, outcome: "sent" });
  }

  return NextResponse.json({
    sent: results.filter((r) => r.outcome === "sent").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    failed: results.filter((r) => r.outcome === "failed"),
  });
}
