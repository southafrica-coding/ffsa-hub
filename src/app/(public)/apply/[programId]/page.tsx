import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProgramPublicInfo, getQuestionsByProgram, getReferenceSlotsByProgram } from "@/services/schools";
import { getCountryTiers } from "@/services/school-fees";
import { getBillingCoursesByProgram, getProgramChargeItems } from "@/services/school-billing";
import { getCurrentConsentAgreement } from "@/services/consent";
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
  const { data: agreement } = await getCurrentConsentAgreement(supabase);
  const { data: countryRows } = await getCountryTiers(supabase);
  const countries = (countryRows ?? []).map(
    (c: { country_name: string }) => c.country_name
  );

  // Track selection (migration 221) — only offered for a school actually
  // split into segments (FFX: FFX/FFBX/FFWV). Everything else keeps the
  // form exactly as it was: no picker renders, no track_choice is sent.
  const { data: billingCoursesRaw } = await getBillingCoursesByProgram(supabase, programId);
  const segments = (billingCoursesRaw ?? [])
    .filter(
      (c: { scope: string; status: string }) =>
        c.scope === "segment" && (c.status === "active" || c.status === "upcoming")
    )
    .map((c: { id: string; code: string; name: string; sequence: number }) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      sequence: c.sequence,
    }))
    .sort((a: { sequence: number }, b: { sequence: number }) => a.sequence - b.sequence);
  const { data: programChargeItems } = await getProgramChargeItems(supabase, programId);
  const hasWholeProgramOption = (programChargeItems ?? []).length > 0;

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
          segments={segments}
          hasWholeProgramOption={hasWholeProgramOption}
        />
      </PublicFormShell>
    </div>
  );
}
