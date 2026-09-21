import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { PublicFormNotice, PublicFormShell } from "@/components/public-form-shell";
import { TrackIntentForm } from "./track-intent-form";

// Personal link — never index it, and say nothing about who it's for.
export const metadata: Metadata = {
  title: "FFX 2027 — Your plans",
  description: "Tell us which part of FFX 2027 you're doing.",
  robots: { index: false, follow: false },
};

// One-off survey (no scope='segment' billing courses exist for FFX yet —
// see migration 222). Segment names/dates are read straight off
// billing_courses regardless of scope, so they stay accurate if finance
// edits the dates later; only the FFX program id below is hardcoded, since
// this whole page only ever serves this one survey.
const FFX_PROGRAM_ID = "f839fd44-0051-4d47-ab8d-b548c5d32648";

export default async function TrackIntentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = createAdminClient();

  const { data: survey } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
    .from("ffx_track_intent_surveys")
    .select(
      "id, intent, submitted_at, application_response_id, " +
        "application_responses(applicant_info, users!application_responses_user_id_fkey(first_name))"
    )
    .eq("token", token)
    .maybeSingle();

  if (!survey) {
    return (
      <PublicFormNotice
        eyebrow="FFX 2027"
        heading="Link not found"
        body="This link isn't valid — it may have been mistyped. Please use the link from the email we sent you."
      />
    );
  }

  const { data: segmentRows } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
    .from("billing_courses")
    .select("id, code, name, start_date, end_date")
    .eq("program_id", FFX_PROGRAM_ID)
    .order("sequence", { ascending: true });

  const segments = (segmentRows ?? []) as Array<{
    id: string;
    code: string;
    name: string;
    start_date: string | null;
    end_date: string | null;
  }>;

  const firstName =
    survey.application_responses?.users?.first_name ||
    survey.application_responses?.applicant_info?.first_name ||
    "there";

  return (
    <div className="ffsa-public">
      <PublicFormShell
        eyebrow="Fire & Fragrance SA Experience 2027"
        heading={`Hi ${firstName}, which part are you doing?`}
        subheading="We're confirming exactly who's doing what, so we can plan accurately. Let us know if you're doing the whole programme or specific sections."
        maxWidth={640}
      >
        <TrackIntentForm
          token={token}
          segments={segments}
          initialIntent={survey.intent ?? null}
          alreadySubmitted={!!survey.submitted_at}
        />
      </PublicFormShell>
    </div>
  );
}
