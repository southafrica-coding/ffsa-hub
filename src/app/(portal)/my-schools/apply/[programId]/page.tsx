import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getQuestionsByProgram,
  getResponseByUserAndProgram,
  getReferenceSlotsByProgram,
} from "@/services/schools";
import { getCountryTiers } from "@/services/school-fees";
import { getTrackSegments } from "@/lib/schools/track-segments";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ApplicationForm } from "./application-form";
import { Masthead, MastheadAction } from "@/components/ffsa";

export default async function ApplyPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  const { programId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <p>Not authenticated.</p>;
  }

  // Fetch the program
  const { data: program } = await supabase
    .from("programs")
    .select("id, name, code, description, application_open, status")
    .eq("id", programId)
    .single();

  if (!program || program.status !== "active" || !program.application_open) {
    return (
      <div className="ffsa-screen">
        <Masthead context="Application" title="Not available" />
        <p className="px-5 py-8 text-sm text-[color:var(--text-secondary)] md:px-8">
          This application is not currently open.
        </p>
      </div>
    );
  }

  // Check if already applied
  const { data: existingResponse } = await getResponseByUserAndProgram(
    supabase,
    user.id,
    programId
  );

  if (existingResponse) {
    const statusColors: Record<string, "default" | "secondary" | "destructive"> = {
      submitted: "secondary",
      accepted: "default",
      rejected: "destructive",
      waitlisted: "secondary",
      cancelled: "secondary",
    };

    return (
      <div className="ffsa-screen">
        <Masthead context="Application" title={program.name} />
        <div className="px-5 py-6 md:px-8 md:py-7">
        <Card>
          <CardContent className="py-8 text-center space-y-3">
            <h2 className="text-lg font-semibold">Application Already Submitted</h2>
            <p className="text-sm text-muted-foreground">
              You submitted your application for {program.name} on{" "}
              {new Date(existingResponse.submitted_at).toLocaleDateString()}.
            </p>
            <div>
              <Badge variant={statusColors[existingResponse.status] ?? "secondary"}>
                Status: {existingResponse.status}
              </Badge>
            </div>
          </CardContent>
        </Card>
        </div>
      </div>
    );
  }

  // Fetch questions and reference slots
  const { data: questions } = await getQuestionsByProgram(supabase, programId);
  const { data: referenceSlots } = await getReferenceSlotsByProgram(supabase, programId);

  // Country list for the nationality / home-country dropdowns — the same
  // tier-keyed country names the public form and fee-tier logic use. Reference
  // data, readable by any authenticated user.
  const { data: countryRows } = await getCountryTiers(supabase);
  const countries = (countryRows ?? []).map(
    (c: { country_name: string }) => c.country_name
  );

  // Prefill nationality from the applicant's profile when it's already set
  // (still required — they can confirm or change it).
  const { data: profile } = await supabase
    .from("users")
    .select("nationality")
    .eq("id", user.id)
    .maybeSingle();

  // Track selection (migration 221) — only offered for a school actually
  // split into segments (FFX: FFX/FFBX/FFWV). Mirrors the public apply page;
  // everything else keeps the form exactly as it was.
  const segments = (await getTrackSegments(supabase, programId)).map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    sequence: c.sequence,
  }));
  // The whole programme is always on offer alongside the segments — whether
  // finance has priced it yet is a billing question, not an availability one.
  const hasWholeProgramOption = segments.length > 0;

  if (!questions || questions.length === 0) {
    return (
      <div className="ffsa-screen">
        <Masthead context="Application" title="Not ready yet" />
        <p className="px-5 py-8 text-sm text-[color:var(--text-secondary)] md:px-8">
          This application has no questions yet — please check back later.
        </p>
      </div>
    );
  }

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`Application · ${program.code}`}
        title={`Apply to ${program.name}`}
        actions={<MastheadAction href="/my-schools">My training</MastheadAction>}
      />

      {program.description && (
        <p className="max-w-3xl border-b border-rule px-5 py-4 text-[14px] leading-relaxed text-[color:var(--text-secondary)] md:px-8">
          {program.description}
        </p>
      )}

      <div className="px-5 py-6 md:px-8 md:py-7">
      <ApplicationForm
        programId={programId}
        questions={questions}
        referenceSlots={referenceSlots ?? []}
        countries={countries}
        initialNationality={profile?.nationality ?? ""}
        segments={segments}
        hasWholeProgramOption={hasWholeProgramOption}
      />
      </div>
    </div>
  );
}
