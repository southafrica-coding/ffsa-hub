import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getReferenceSlotsByProgram } from "@/services/schools";
import { sendApplicantReferenceRequest } from "@/lib/email/send-applicant-reference-request";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

type ApplicationRow = {
  id: string;
  program_id: string;
  status: string;
  status_token: string | null;
  applicant_email: string | null;
  applicant_info: Record<string, string> | null;
};

// Email one applicant asking them to add the required references they didn't
// provide at submit time. Returns whether an email was actually sent (skips
// applications that aren't missing anything, or have no reachable email).
async function requestFromApplication(
  adminSupabase: Client,
  application: ApplicationRow,
  requiredSlots: Array<{ id: string; label: string }>,
  programName: string
): Promise<{ sent: boolean; reason?: string }> {
  if (requiredSlots.length === 0) return { sent: false, reason: "no required references" };

  const { data: existingRefs } = await adminSupabase
    .from("reference_requests")
    .select("slot_id")
    .eq("application_id", application.id);

  const filledSlotIds = new Set(
    (existingRefs ?? []).map((r: { slot_id: string }) => r.slot_id)
  );
  const missing = requiredSlots.filter((s) => !filledSlotIds.has(s.id));
  if (missing.length === 0) return { sent: false, reason: "not missing any references" };

  const email =
    application.applicant_email || application.applicant_info?.email || null;
  if (!email) return { sent: false, reason: "no applicant email" };

  if (!application.status_token) return { sent: false, reason: "no status token" };

  const firstName = application.applicant_info?.first_name || "Applicant";

  await sendApplicantReferenceRequest({
    toEmail: email,
    firstName,
    programName,
    missingLabels: missing.map((s) => s.label),
    statusToken: application.status_token,
  });

  await adminSupabase
    .from("application_responses")
    .update({ references_requested_at: new Date().toISOString() })
    .eq("id", application.id);

  return { sent: true };
}

const APPLICATION_SELECT =
  "id, program_id, status, status_token, applicant_email, applicant_info, programs(name)";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const applicationId = body?.application_id as string | undefined;
  const programId = body?.program_id as string | undefined;
  const all = body?.all === true;

  const adminSupabase = createAdminClient();

  // ── Single applicant ──
  if (applicationId) {
    const { data: application } = await adminSupabase
      .from("application_responses")
      .select(APPLICATION_SELECT)
      .eq("id", applicationId)
      .single();

    if (!application) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }

    const { data: slots } = await getReferenceSlotsByProgram(
      adminSupabase,
      application.program_id
    );
    const requiredSlots = (slots ?? [])
      .filter((s: { is_required: boolean }) => s.is_required)
      .map((s: { id: string; label: string }) => ({ id: s.id, label: s.label }));
    const programName =
      (application.programs as { name: string } | null)?.name ?? "School Program";

    const result = await requestFromApplication(
      adminSupabase,
      application as ApplicationRow,
      requiredSlots,
      programName
    );

    if (!result.sent) {
      return NextResponse.json(
        { error: `Couldn't send: ${result.reason}.` },
        { status: 400 }
      );
    }
    return NextResponse.json({ success: true, emailed: 1 });
  }

  // ── Bulk: every applicant for a program that is missing a required reference ──
  if (programId && all) {
    const { data: slots } = await getReferenceSlotsByProgram(adminSupabase, programId);
    const requiredSlots = (slots ?? [])
      .filter((s: { is_required: boolean }) => s.is_required)
      .map((s: { id: string; label: string }) => ({ id: s.id, label: s.label }));

    if (requiredSlots.length === 0) {
      return NextResponse.json({ success: true, emailed: 0 });
    }

    const { data: applications } = await adminSupabase
      .from("application_responses")
      .select(APPLICATION_SELECT)
      .eq("program_id", programId)
      .is("removed_at", null);

    const { data: program } = await adminSupabase
      .from("programs")
      .select("name")
      .eq("id", programId)
      .single();
    const programName = program?.name ?? "School Program";

    let emailed = 0;
    for (const application of (applications ?? []) as ApplicationRow[]) {
      const result = await requestFromApplication(
        adminSupabase,
        application,
        requiredSlots,
        programName
      );
      if (result.sent) emailed++;
    }

    return NextResponse.json({ success: true, emailed });
  }

  return NextResponse.json(
    { error: "Provide either application_id, or program_id with all:true" },
    { status: 400 }
  );
}
