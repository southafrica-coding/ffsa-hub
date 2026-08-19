import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProgramPublicInfo, getQuestionsByProgram, getReferenceSlotsByProgram } from "@/services/schools";
import { getCountryTiers } from "@/services/school-fees";
import { getCurrentConsentAgreement } from "@/services/consent";
import { hasEnoughReferenceSlots } from "@/lib/references/minimum-slots";
import { PublicApplicationForm } from "./public-application-form";
import {
  PublicFormNotice,
  PublicFormShell,
  PublicFormInputStyles,
} from "@/components/public-form-shell";

/** What a messaging app shows when an application link is pasted. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ programId: string }>;
}): Promise<Metadata> {
  const { programId } = await params;
  const supabase = createAdminClient();
  const { data: program } = await getProgramPublicInfo(supabase, programId);

  if (!program) return { title: "Programme not found" };

  const title = `Apply · ${program.name}`;
  const description = program.application_open
    ? `Applications are open for ${program.name}. Start your application.`
    : `Applications for ${program.name} are currently closed.`;

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PublicApplyPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  const { programId } = await params;
  const supabase = createAdminClient();

  const { data: program } = await getProgramPublicInfo(supabase, programId);

  // Check if deadline has passed
  const deadlinePassed = program?.application_deadline
    ? new Date(program.application_deadline) < new Date()
    : false;

  if (!program || program.status !== "active" || !program.application_open || deadlinePassed) {
    const body = deadlinePassed
      ? `The application deadline for ${program.name} has passed.`
      : program
        ? `Applications for ${program.name} are currently closed. Please check back later.`
        : "This program was not found or is no longer available.";
    return (
      <PublicFormNotice
        eyebrow="Applications"
        heading="Applications closed"
        body={body}
      />
    );
  }

  const { data: questions } = await getQuestionsByProgram(supabase, programId);
  const { data: referenceSlots } = await getReferenceSlotsByProgram(supabase, programId);

  // A program whose references haven't been set up can't take applications —
  // the submit endpoint refuses them (see minimum-slots.ts). Catch it here so
  // nobody fills in a long form only to be turned away at the end. Reads as
  // "not open yet", because from the applicant's side that's exactly what it
  // is; the shortfall is flagged to staff in the program's form builder.
  if (!hasEnoughReferenceSlots(referenceSlots)) {
    return (
      <PublicFormNotice
        eyebrow="Applications"
        heading="Not open yet"
        body={`Applications for ${program.name} aren't open just yet. Please check back shortly.`}
      />
    );
  }

  const { data: agreement } = await getCurrentConsentAgreement(supabase);
  const { data: countryRows } = await getCountryTiers(supabase);
  const countries = (countryRows ?? []).map(
    (c: { country_name: string }) => c.country_name
  );

  return (
    <div className="ffsa-public">
      <PublicFormInputStyles />
      <PublicFormShell
        eyebrow="Application"
        heading={`Apply to ${program.name}`}
        subheading={program.description ?? undefined}
        maxWidth={680}
      >
        <PublicApplicationForm
          programId={programId}
          programName={program.name}
          questions={questions ?? []}
          referenceSlots={referenceSlots ?? []}
          countries={countries}
          consentAgreementVersion={agreement?.version ?? null}
        />
      </PublicFormShell>
    </div>
  );
}
