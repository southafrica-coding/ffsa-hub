import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import { adminNotesByResponse } from "@/lib/schools/admin-notes";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function ratingColor(rating: string): string {
  switch (rating) {
    case "Excellent": return "#16a34a";
    case "Good": return "#2563eb";
    case "Fair": return "#ca8a04";
    case "Poor": return "#dc2626";
    default: return "#6b7280";
  }
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
  const responseId = searchParams.get("response_id");

  if (!responseId) {
    return NextResponse.json(
      { error: "response_id is required" },
      { status: 400 }
    );
  }

  // Fetch the application response
  const { data: response, error: responseError } = await supabase
    .from("application_responses")
    .select("*")
    .eq("id", responseId)
    .single();

  if (responseError || !response) {
    return NextResponse.json(
      { error: "Application not found" },
      { status: 404 }
    );
  }

  // Fetch program info
  const { data: program } = await supabase
    .from("programs")
    .select("name, code")
    .eq("id", response.program_id)
    .single();

  // Fetch questions for this program
  const { data: questions } = await supabase
    .from("application_questions")
    .select("id, label, type, sort_order")
    .eq("program_id", response.program_id)
    .order("sort_order", { ascending: true });

  const allQuestions = (questions ?? []).filter(
    (q) => q.type !== "section_header"
  );

  // Get user info
  const applicantInfo = response.applicant_info as Record<string, any> | null;
  let userName = "";
  let userEmail = "";

  if (response.user_id) {
    const { data: userRecord } = await supabase
      .from("users")
      .select("first_name, last_name, email")
      .eq("id", response.user_id)
      .single();

    if (userRecord) {
      userName = `${userRecord.first_name ?? ""} ${userRecord.last_name ?? ""}`.trim();
      userEmail = userRecord.email ?? "";
    }
  }

  if (!userName && applicantInfo) {
    userName = `${applicantInfo.first_name ?? ""} ${applicantInfo.last_name ?? ""}`.trim();
  }
  if (!userEmail) {
    userEmail =
      response.applicant_email ??
      (applicantInfo?.email as string | undefined) ??
      "";
  }

  // Fetch reference requests with full data
  const { data: refRequests } = await (supabase as any)
    .from("reference_requests")
    .select("*, reference_slots(label, description)")
    .eq("application_id", responseId)
    .order("created_at", { ascending: true });

  const refs = ((refRequests ?? []) as any[]);

  // Build answers map
  const answersArray = (response.answers as Array<{
    question_id: string;
    question_label?: string;
    answer: string;
  }>) ?? [];
  const answersMap = new Map<string, string>();
  for (const a of answersArray) {
    answersMap.set(a.question_id, a.answer);
  }

  // select("*") above still returns admin_notes. This PDF does not print
  // that column. Leaders' notes are loaded below from application_admin_notes,
  // and only for someone who can manage the program. The column stays
  // populated until the follow-up SQL in docs/program-staff.md.
  let adminNotes = "";
  if (await userCanManageProgram(supabase, user.id, response.program_id)) {
    const notes = await adminNotesByResponse(supabase, [responseId]);
    adminNotes = notes.get(responseId) ?? "";
  }
  const submittedDate = response.submitted_at
    ? new Date(response.submitted_at).toLocaleDateString("en-ZA", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "N/A";

  const programName = program?.name ?? "Unknown Program";
  const programCode = program?.code ?? "";

  // Status badge class
  const statusClass: Record<string, string> = {
    submitted: "background:#dbeafe;color:#1e40af;",
    references_received: "background:#e0e7ff;color:#3730a3;",
    interview_scheduled: "background:#f3e8ff;color:#6b21a8;",
    accepted: "background:#d1fae5;color:#065f46;",
    rejected: "background:#fee2e2;color:#991b1b;",
    waitlisted: "background:#fef3c7;color:#92400e;",
    cancelled: "background:#e5e7eb;color:#374151;",
  };

  // Generate signed URLs for any photo/file answers
  const adminSupabase = createAdminClient();
  const photoUrls = new Map<string, string>();
  for (const q of allQuestions) {
    const answer = answersMap.get(q.id) ?? "";
    if (answer.startsWith("applications/") && answer.length > 20) {
      const { data: signedData } = await adminSupabase.storage
        .from("application-uploads")
        .createSignedUrl(answer, 3600);
      if (signedData?.signedUrl) {
        photoUrls.set(q.id, signedData.signedUrl);
      }
    }
  }

  // Build Q&A HTML
  let questionsHtml = "";
  for (const q of allQuestions) {
    const answer = answersMap.get(q.id) ?? "";
    const photoUrl = photoUrls.get(q.id);
    let answerHtml: string;
    if (photoUrl) {
      answerHtml = `<img src="${photoUrl}" alt="Applicant photo" style="max-width:200px;max-height:250px;border-radius:8px;border:1px solid #ddd;" />`;
    } else if (answer) {
      answerHtml = escapeHtml(answer);
    } else {
      answerHtml = '<span class="empty">No answer provided</span>';
    }
    questionsHtml += `
      <div class="qa-block">
        <div class="question">${escapeHtml(q.label)}</div>
        <div class="answer">${answerHtml}</div>
      </div>`;
  }

  // Build references HTML with ALL form_data
  let referencesHtml = "";
  if (refs.length > 0) {
    for (const ref of refs) {
      const slot = ref.reference_slots as any;
      const slotLabel = slot?.label ?? "Reference";
      const status = (ref.status as string) ?? "pending";
      const isSubmitted = status === "submitted";
      const fd = ref.form_data as Record<string, any> | null;

      let refDetail = `
        <div class="ref-block">
          <div class="ref-header">
            <strong>${escapeHtml(slotLabel)}</strong>
            <span class="ref-status" style="${isSubmitted ? "background:#d1fae5;color:#065f46;" : "background:#fef3c7;color:#92400e;"}">${isSubmitted ? "Submitted" : "Pending"}</span>
          </div>
          <div class="ref-info">
            <span>${escapeHtml(ref.referee_name as string)}</span>
            <span class="ref-email">&middot; ${escapeHtml(ref.referee_email as string)}</span>
          </div>`;

      if (isSubmitted) {
        // Basic info row
        const basicInfo: string[] = [];
        if (ref.relationship) basicInfo.push(`<strong>Relationship:</strong> ${escapeHtml(ref.relationship as string)}`);
        if (ref.known_duration) basicInfo.push(`<strong>Known for:</strong> ${escapeHtml(ref.known_duration as string)}`);
        if (fd?.whatsapp_number) basicInfo.push(`<strong>WhatsApp:</strong> ${escapeHtml(fd.whatsapp_number)}`);
        if (basicInfo.length > 0) {
          refDetail += `<div class="ref-basic-row">${basicInfo.join(" &middot; ")}</div>`;
        }

        // Growth/Discipleship Context
        if (fd?.growth_context) {
          refDetail += `
            <div class="ref-section">
              <div class="ref-section-label">Growth/Discipleship Context</div>
              <div class="ref-section-body">${escapeHtml(fd.growth_context)}</div>
            </div>`;
        }

        // Character Assessment Ratings
        const ratings = fd?.character_ratings as Record<string, string> | undefined;
        if (ratings && Object.keys(ratings).length > 0) {
          let ratingsHtml = '<div class="ratings-grid">';
          for (const [trait, rating] of Object.entries(ratings)) {
            ratingsHtml += `
              <div class="rating-item">
                <span class="rating-trait">${escapeHtml(trait)}</span>
                <span class="rating-value" style="color:${ratingColor(rating)}">${escapeHtml(rating)}</span>
              </div>`;
          }
          ratingsHtml += '</div>';
          refDetail += `
            <div class="ref-section">
              <div class="ref-section-label">Character Assessment</div>
              ${ratingsHtml}
            </div>`;
        }

        // Additional Comments on Character
        if (fd?.additional_comments) {
          refDetail += `
            <div class="ref-section">
              <div class="ref-section-label">Additional Comments on Character</div>
              <div class="ref-section-body">${escapeHtml(fd.additional_comments)}</div>
            </div>`;
        }

        // Christian History
        if (fd?.christian_history) {
          refDetail += `
            <div class="ref-section">
              <div class="ref-section-label">Christian History</div>
              <div class="ref-section-body"><strong>${escapeHtml(fd.christian_history)}</strong>${fd.christian_history_why ? ` — ${escapeHtml(fd.christian_history_why)}` : ""}</div>
            </div>`;
        }

        // Strengths & Weaknesses
        if (fd?.strengths_weaknesses) {
          refDetail += `
            <div class="ref-section">
              <div class="ref-section-label">Strengths &amp; Weaknesses</div>
              <div class="ref-section-body">${escapeHtml(fd.strengths_weaknesses)}</div>
            </div>`;
        }

        // Seeking Growth
        if (fd?.seeking_growth) {
          refDetail += `
            <div class="ref-section">
              <div class="ref-section-label">Actively Seeking Growth</div>
              <div class="ref-section-body">${escapeHtml(fd.seeking_growth)}</div>
            </div>`;
        }

        // Missions/Ministry
        if (fd?.missions_ministry) {
          refDetail += `
            <div class="ref-section">
              <div class="ref-section-label">Missions/Ministry Area</div>
              <div class="ref-section-body">${escapeHtml(fd.missions_ministry)}</div>
            </div>`;
        }

        // Recommendation
        if (fd?.recommendation) {
          const recColor = fd.recommendation === "Yes" ? "#16a34a" : fd.recommendation === "No" ? "#dc2626" : "#ca8a04";
          refDetail += `
            <div class="ref-section">
              <div class="ref-section-label">Recommendation</div>
              <div class="ref-section-body">
                <span style="font-weight:700;color:${recColor}">${escapeHtml(fd.recommendation)}</span>
                ${fd.recommendation_explanation ? `<br/>${escapeHtml(fd.recommendation_explanation)}` : ""}
              </div>
            </div>`;
        }

        // Other Comments
        if (fd?.other_comments) {
          refDetail += `
            <div class="ref-section">
              <div class="ref-section-label">Other Comments</div>
              <div class="ref-section-body">${escapeHtml(fd.other_comments)}</div>
            </div>`;
        }

        // Fallback for old-style references
        if (!fd && ref.reference_text) {
          refDetail += `
            <div class="ref-section">
              <div class="ref-section-label">Reference</div>
              <div class="ref-section-body">${escapeHtml(ref.reference_text as string)}</div>
            </div>`;
        }
      }

      refDetail += `</div>`;
      referencesHtml += refDetail;
    }
  } else {
    referencesHtml = '<p class="empty">No references requested</p>';
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Application — ${escapeHtml(userName || "Applicant")} — ${escapeHtml(programName)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6;
      color: #1a1a1a;
      background: #fff;
      padding: 0;
      max-width: 800px;
      margin: 0 auto;
    }
    .print-bar {
      background: #f8f9fa;
      border-bottom: 1px solid #e5e7eb;
      padding: 0.75rem 2rem;
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
    }
    .print-btn {
      background: #0D0B09;
      color: #F5C518;
      border: none;
      padding: 0.5rem 1.5rem;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      cursor: pointer;
    }
    .print-btn:hover { background: #1a1815; }
    .content { padding: 2rem; }

    /* Header / Logo */
    .letterhead {
      text-align: center;
      padding: 2rem 2rem 1.5rem;
      border-bottom: 3px solid #F5C518;
      margin-bottom: 0;
    }
    .letterhead-brand {
      font-size: 1.6rem;
      font-weight: 900;
      letter-spacing: 0.06em;
      color: #0D0B09;
      font-family: "Arial Black", Arial, sans-serif;
    }
    .letterhead-sub {
      margin-top: 4px;
      font-size: 0.6rem;
      letter-spacing: 0.3em;
      font-weight: 700;
      color: #0D0B09;
      text-transform: uppercase;
    }
    .letterhead-sub span {
      display: inline-block;
      width: 20px;
      height: 1px;
      background: #F5C518;
      vertical-align: middle;
      margin: 0 6px;
    }
    .letterhead-tagline {
      margin-top: 6px;
      font-size: 0.55rem;
      letter-spacing: 0.2em;
      color: #999;
      text-transform: uppercase;
    }

    .doc-type {
      text-align: center;
      padding: 1rem 2rem;
      background: #fafaf8;
      border-bottom: 1px solid #e5e7eb;
    }
    .doc-type h1 {
      font-size: 0.7rem;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: #666;
      font-weight: 700;
    }

    .applicant-header {
      padding: 1.5rem 2rem;
      background: #fafaf8;
      border-bottom: 1px solid #e5e7eb;
    }
    .applicant-name {
      font-size: 1.4rem;
      font-weight: 800;
      color: #0D0B09;
    }
    .applicant-program {
      font-size: 0.9rem;
      color: #666;
      margin-top: 2px;
    }

    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem 2rem;
      margin-bottom: 2rem;
      padding: 1rem 1.25rem;
      background: #fafaf8;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
    }
    .meta-label {
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #888;
      font-weight: 600;
    }
    .meta-value {
      font-size: 0.9rem;
      font-weight: 500;
    }
    .status-badge {
      display: inline-block;
      padding: 0.15rem 0.6rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: capitalize;
    }
    section {
      margin-bottom: 2rem;
    }
    section h2 {
      font-size: 0.75rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      font-weight: 700;
      color: #0D0B09;
      padding-bottom: 0.5rem;
      border-bottom: 2px solid #F5C518;
      margin-bottom: 1rem;
    }
    .qa-block {
      margin-bottom: 1.25rem;
    }
    .question {
      font-weight: 600;
      font-size: 0.85rem;
      margin-bottom: 0.2rem;
      color: #333;
    }
    .answer {
      font-size: 0.9rem;
      white-space: pre-wrap;
      color: #1a1a1a;
    }
    .empty {
      color: #9ca3af;
      font-style: italic;
    }

    /* Reference blocks */
    .ref-block {
      padding: 1rem 1.25rem;
      background: #fafaf8;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
      margin-bottom: 1rem;
      page-break-inside: avoid;
    }
    .ref-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.25rem;
      font-size: 0.95rem;
    }
    .ref-status {
      font-size: 0.7rem;
      padding: 0.15rem 0.6rem;
      border-radius: 9999px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .ref-info {
      font-size: 0.85rem;
      color: #555;
      margin-bottom: 0.75rem;
    }
    .ref-email {
      color: #888;
      margin-left: 0.25rem;
    }
    .ref-basic-row {
      font-size: 0.8rem;
      color: #555;
      margin-bottom: 0.75rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid #e5e7eb;
    }
    .ref-section {
      margin-bottom: 0.75rem;
    }
    .ref-section-label {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #888;
      margin-bottom: 0.2rem;
    }
    .ref-section-body {
      font-size: 0.85rem;
      white-space: pre-wrap;
      line-height: 1.5;
    }
    .ratings-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.15rem 2rem;
      font-size: 0.8rem;
    }
    .rating-item {
      display: flex;
      justify-content: space-between;
      padding: 0.15rem 0;
    }
    .rating-trait {
      color: #555;
    }
    .rating-value {
      font-weight: 700;
    }

    .admin-notes {
      white-space: pre-wrap;
      padding: 0.75rem 1rem;
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 6px;
      font-size: 0.9rem;
    }

    .footer {
      text-align: center;
      padding: 1.5rem 2rem;
      border-top: 1px solid #e5e7eb;
      margin-top: 2rem;
    }
    .footer-text {
      font-size: 0.6rem;
      letter-spacing: 0.15em;
      color: #bbb;
      text-transform: uppercase;
    }

    @media print {
      .print-bar { display: none; }
      body { padding: 0; }
      .content { padding: 1.5rem; }
      .letterhead { padding: 1.5rem 1.5rem 1rem; }
      .meta-grid, .ref-block, .admin-notes { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .status-badge, .ref-status { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .letterhead { border-bottom-color: #F5C518; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      section h2 { border-bottom-color: #F5C518; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .rating-value { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="print-bar">
    <button class="print-btn" onclick="window.print()">Print / Save PDF</button>
  </div>

  <!-- Letterhead -->
  <div class="letterhead">
    <div class="letterhead-brand">FIRE &amp; FRAGRANCE</div>
    <div class="letterhead-sub"><span></span> SOUTH AFRICA <span></span></div>
    <div class="letterhead-tagline">Catalyse a Generation &middot; Evangelise the World</div>
  </div>

  <div class="doc-type">
    <h1>Application Record</h1>
  </div>

  <div class="applicant-header">
    <div class="applicant-name">${escapeHtml(userName || "Applicant")}</div>
    <div class="applicant-program">${escapeHtml(programName)}${programCode ? ` (${escapeHtml(programCode)})` : ""}</div>
  </div>

  <div class="content">
    <div class="meta-grid">
      <div>
        <div class="meta-label">Email</div>
        <div class="meta-value">${escapeHtml(userEmail || "N/A")}</div>
      </div>
      <div>
        <div class="meta-label">Status</div>
        <div class="meta-value">
          <span class="status-badge" style="${statusClass[response.status] ?? "background:#f3f4f6;color:#374151;"}">${escapeHtml(response.status.replace(/_/g, " "))}</span>
        </div>
      </div>
      <div>
        <div class="meta-label">Submitted</div>
        <div class="meta-value">${escapeHtml(submittedDate)}</div>
      </div>
      <div>
        <div class="meta-label">Application ID</div>
        <div class="meta-value" style="font-size:0.75rem;color:#999;">${escapeHtml(response.id)}</div>
      </div>
    </div>

    <section>
      <h2>Application Responses</h2>
      ${questionsHtml}
    </section>

    <section>
      <h2>References</h2>
      ${referencesHtml}
    </section>

    ${adminNotes ? `
    <section>
      <h2>Admin Notes</h2>
      <div class="admin-notes">${escapeHtml(adminNotes)}</div>
    </section>
    ` : ""}
  </div>

  <div class="footer">
    <div class="footer-text">Fire &amp; Fragrance South Africa &middot; ffsahub.com</div>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
