import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getQuestionsByProgram,
  getResponseByUserAndProgram,
  getReferenceSlotsByProgram,
} from "@/services/schools";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ApplicationForm } from "./application-form";

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
      <div className="space-y-4">
        <Link
          href="/my-schools"
          className="text-sm text-muted-foreground hover:underline"
        >
          &larr; Back to My Training
        </Link>
        <p className="text-destructive">
          This application is not currently available.
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
      <div className="space-y-4">
        <Link
          href="/my-schools"
          className="text-sm text-muted-foreground hover:underline"
        >
          &larr; Back to My Training
        </Link>
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
    );
  }

  // Fetch questions and reference slots
  const { data: questions } = await getQuestionsByProgram(supabase, programId);
  const { data: referenceSlots } = await getReferenceSlotsByProgram(supabase, programId);

  if (!questions || questions.length === 0) {
    return (
      <div className="space-y-4">
        <Link
          href="/my-schools"
          className="text-sm text-muted-foreground hover:underline"
        >
          &larr; Back to My Training
        </Link>
        <p className="text-muted-foreground">
          This application has no questions yet. Please check back later.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/my-schools"
        className="text-sm text-muted-foreground hover:underline"
      >
        &larr; Back to My Training
      </Link>

      <div>
        <h1 className="page-title">
          Apply to {program.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {program.code}
          {program.description && ` — ${program.description}`}
        </p>
      </div>

      <ApplicationForm programId={programId} questions={questions} referenceSlots={referenceSlots ?? []} />
    </div>
  );
}
