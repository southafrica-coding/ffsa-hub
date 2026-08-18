import type { Metadata } from "next";

// The link preview says what this link IS. It deliberately names no
// person: a preview card renders in whatever chat the link was pasted
// into, so pulling the applicant's or recipient's name in here would
// leak them to everyone in the room.
export const metadata: Metadata = {
  title: "Reference request",
  description: "A short, confidential reference form for a Fire & Fragrance South Africa school applicant.",
  openGraph: {
    title: "Reference request",
    description: "A short, confidential reference form for a Fire & Fragrance South Africa school applicant.",
    type: "website",
  },
  // Personal link — never index it.
  robots: { index: false, follow: false },
};

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getReferenceRequestByToken,
  getReferenceQuestionsByProgram,
} from "@/services/schools";
import { ReferenceForm } from "./reference-form";
import { PublicFormNotice } from "@/components/public-form-shell";

export default async function ReferencePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = createAdminClient();

  const { data: refRequest, error } = await getReferenceRequestByToken(
    supabase,
    token
  );

  if (error || !refRequest) {
    return (
      <PublicFormNotice
        eyebrow="Reference Form"
        heading="Invalid link"
        body="This reference link is invalid or has expired. Please contact the applicant for a new link."
      />
    );
  }

  if (refRequest.status === "submitted") {
    return (
      <PublicFormNotice
        eyebrow="Reference Form"
        heading="Already submitted"
        body="Thank you! Your reference has already been submitted. No further action is needed."
      />
    );
  }

  const app = refRequest.application_responses as any;
  const slot = refRequest.reference_slots as any;

  const applicantName = app?.applicant_info
    ? [app.applicant_info.first_name, app.applicant_info.last_name].filter(Boolean).join(" ") || "the applicant"
    : "the applicant";

  const programName = app?.programs?.name ?? "the program";

  const { data: referenceQuestions } = app?.program_id
    ? await getReferenceQuestionsByProgram(supabase, app.program_id)
    : { data: [] };

  return (
    <ReferenceForm
      token={token}
      refereeName={refRequest.referee_name}
      applicantName={applicantName}
      programName={programName}
      slotLabel={slot?.label ?? "Reference"}
      slotDescription={slot?.description ?? null}
      questions={referenceQuestions ?? []}
    />
  );
}
