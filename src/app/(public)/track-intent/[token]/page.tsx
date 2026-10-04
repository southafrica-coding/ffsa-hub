import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { PublicFormNotice, PublicFormShell } from "@/components/public-form-shell";
import { TrackIntentForm } from "./track-intent-form";
import { getTrackSegments } from "@/lib/schools/track-segments";

// Personal link — never index it, and say nothing about who it's for.
export const metadata: Metadata = {
  title: "Your plans",
  description: "Tell us which part of the programme you're doing.",
  robots: { index: false, follow: false },
};

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
        "application_responses(program_id, applicant_info, programs(name), users!application_responses_user_id_fkey(first_name))"
    )
    .eq("token", token)
    .maybeSingle();

  if (!survey) {
    return (
      <PublicFormNotice
        eyebrow="Your plans"
        heading="Link not found"
        body="This link isn't valid — it may have been mistyped. Please use the link from the email we sent you."
      />
    );
  }

  const segments = await getTrackSegments(
    supabase,
    survey.application_responses?.program_id,
    ["active", "upcoming", "completed"]
  );
  const programName: string = survey.application_responses?.programs?.name ?? "the programme";

  const firstName =
    survey.application_responses?.users?.first_name ||
    survey.application_responses?.applicant_info?.first_name ||
    "there";

  return (
    <div className="ffsa-public">
      <PublicFormShell
        eyebrow={programName}
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
