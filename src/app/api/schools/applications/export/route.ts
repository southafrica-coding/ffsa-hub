import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { passesApplicationExpiry, APPLICATIONS_EXPIRED_MESSAGE } from "@/lib/auth/application-expiry";
import { adminNotesByResponse } from "@/lib/schools/admin-notes";

function escapeCsvValue(value: string): string {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const programId = searchParams.get("program_id");

  if (!programId) {
    return NextResponse.json(
      { error: "program_id is required" },
      { status: 400 }
    );
  }

  if (!(await passesApplicationExpiry(supabase, programId))) {
    return NextResponse.json({ error: APPLICATIONS_EXPIRED_MESSAGE }, { status: 403 });
  }

  // Fetch program info
  const { data: program, error: programError } = await supabase
    .from("programs")
    .select("name, code")
    .eq("id", programId)
    .single();

  if (programError || !program) {
    return NextResponse.json(
      { error: "Program not found" },
      { status: 404 }
    );
  }

  // Fetch all questions for this program, ordered by sort_order
  const { data: questions } = await supabase
    .from("application_questions")
    .select("id, label, sort_order, type")
    .eq("program_id", programId)
    .order("sort_order", { ascending: true });

  const allQuestions = (questions ?? []).filter(
    (q) => q.type !== "section_header"
  );

  // Fetch all application responses for this program
  const { data: responses } = await supabase
    .from("application_responses")
    .select("*")
    .eq("program_id", programId)
    .is("removed_at", null)
    .order("submitted_at", { ascending: true });

  const allResponses = responses ?? [];
  const leaderNotes = await adminNotesByResponse(
    supabase,
    allResponses.map((response) => response.id)
  );

  // Fetch user info for responses that have a user_id
  const userIds = allResponses
    .map((r) => r.user_id)
    .filter((id): id is string => !!id);

  const usersMap = new Map<
    string,
    { first_name: string | null; last_name: string | null; email: string | null }
  >();

  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from("users")
      .select("id, first_name, last_name, email")
      .in("id", userIds);

    for (const u of users ?? []) {
      usersMap.set(u.id, u);
    }
  }

  // Fetch all reference requests for these applications (including full form_data)
  const applicationIds = allResponses.map((r) => r.id);
  const referencesMap = new Map<string, any[]>();

  if (applicationIds.length > 0) {
    const { data: refRequests } = await (supabase as any)
      .from("reference_requests")
      .select("*, reference_slots(label)")
      .in("application_id", applicationIds);

    for (const ref of (refRequests ?? []) as any[]) {
      const appId = ref.application_id as string;
      if (!referencesMap.has(appId)) {
        referencesMap.set(appId, []);
      }
      referencesMap.get(appId)!.push(ref);
    }
  }

  // Build CSV headers
  const headers = [
    "Name",
    "Email",
    "Status",
    "Submitted Date",
    ...allQuestions.map((q) => q.label),
    "References Summary",
    "Admin Notes",
  ];

  // Add per-reference columns for each reference slot
  // Find max reference count
  let maxRefs = 0;
  for (const refs of referencesMap.values()) {
    if (refs.length > maxRefs) maxRefs = refs.length;
  }

  for (let i = 0; i < maxRefs; i++) {
    const n = i + 1;
    headers.push(
      `Ref ${n} — Type`,
      `Ref ${n} — Referee`,
      `Ref ${n} — Email`,
      `Ref ${n} — Status`,
      `Ref ${n} — Relationship`,
      `Ref ${n} — Known Duration`,
      `Ref ${n} — Growth/Discipleship`,
      `Ref ${n} — Character Ratings`,
      `Ref ${n} — Character Comments`,
      `Ref ${n} — Christian History`,
      `Ref ${n} — Strengths & Weaknesses`,
      `Ref ${n} — Seeking Growth`,
      `Ref ${n} — Missions/Ministry`,
      `Ref ${n} — Recommendation`,
      `Ref ${n} — Recommendation Explanation`,
      `Ref ${n} — Other Comments`,
    );
  }

  // Build CSV rows
  const rows: string[][] = [];

  for (const response of allResponses) {
    const applicantInfo = response.applicant_info as Record<string, any> | null;
    const userRecord = response.user_id
      ? usersMap.get(response.user_id)
      : null;

    let name = "";
    if (userRecord?.first_name || userRecord?.last_name) {
      name = `${userRecord.first_name ?? ""} ${userRecord.last_name ?? ""}`.trim();
    } else if (applicantInfo) {
      name = `${applicantInfo.first_name ?? ""} ${applicantInfo.last_name ?? ""}`.trim();
    }

    let email = "";
    if (userRecord?.email) {
      email = userRecord.email;
    } else if (response.applicant_email) {
      email = response.applicant_email;
    } else if (applicantInfo?.email) {
      email = applicantInfo.email;
    }

    const status = response.status ?? "";
    const submittedAt = response.submitted_at
      ? new Date(response.submitted_at).toLocaleDateString("en-ZA")
      : "";

    const answersArray = (response.answers as Array<{
      question_id: string;
      question_label?: string;
      answer: string;
    }>) ?? [];
    const answersMap = new Map<string, string>();
    for (const a of answersArray) {
      answersMap.set(a.question_id, a.answer);
    }

    const questionValues = allQuestions.map(
      (q) => answersMap.get(q.id) ?? ""
    );

    // Build references summary
    const refs = referencesMap.get(response.id) ?? [];
    const referencesStr = refs
      .map((r: any) => `${r.reference_slots?.label ?? "Ref"}: ${r.referee_name} (${r.status})`)
      .join("; ");

    const adminNotes = leaderNotes.get(response.id) ?? "";

    const row: string[] = [
      name,
      email,
      status,
      submittedAt,
      ...questionValues,
      referencesStr,
      adminNotes,
    ];

    // Add per-reference detailed columns
    for (let i = 0; i < maxRefs; i++) {
      const ref = refs[i] as any | undefined;
      if (ref) {
        const fd = ref.form_data as Record<string, any> | null;
        const ratings = fd?.character_ratings as Record<string, string> | undefined;
        const ratingsStr = ratings
          ? Object.entries(ratings).map(([trait, rating]) => `${trait}: ${rating}`).join("; ")
          : "";

        row.push(
          ref.reference_slots?.label ?? "",
          ref.referee_name ?? "",
          ref.referee_email ?? "",
          ref.status ?? "",
          ref.relationship ?? "",
          ref.known_duration ?? "",
          fd?.growth_context ?? "",
          ratingsStr,
          fd?.additional_comments ?? "",
          fd?.christian_history ? `${fd.christian_history}${fd.christian_history_why ? ` — ${fd.christian_history_why}` : ""}` : "",
          fd?.strengths_weaknesses ?? "",
          fd?.seeking_growth ?? "",
          fd?.missions_ministry ?? "",
          fd?.recommendation ?? "",
          fd?.recommendation_explanation ?? "",
          fd?.other_comments ?? "",
        );
      } else {
        // Pad empty columns
        row.push(...Array(16).fill(""));
      }
    }

    rows.push(row);
  }

  // Build CSV content
  const csvLines = [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) => row.map(escapeCsvValue).join(",")),
  ];
  const csvContent = csvLines.join("\n");

  const programCode = program.code || "applications";

  return new Response(csvContent, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${programCode}-applications.csv"`,
    },
  });
}
