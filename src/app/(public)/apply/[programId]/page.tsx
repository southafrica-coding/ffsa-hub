import { createAdminClient } from "@/lib/supabase/admin";
import { getProgramPublicInfo, getQuestionsByProgram, getReferenceSlotsByProgram } from "@/services/schools";
import { getCountryTiers } from "@/services/school-fees";
import { getCurrentConsentAgreement } from "@/services/consent";
import { PublicApplicationForm } from "./public-application-form";
import {
  PublicFormNotice,
  PublicFormShell,
  PublicFormInputStyles,
} from "@/components/public-form-shell";

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
