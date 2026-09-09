import { staffAssignedStudentEmailHtml } from "./templates/staff-assigned-student";
import { staffNewAssignmentEmailHtml } from "./templates/staff-new-assignment";
import { getResend } from "@/lib/email/resend";

type Stage = "application" | "enrollment";

function fullName(parts: { first_name?: string | null; last_name?: string | null; preferred_name?: string | null }) {
  const first = parts.first_name || "";
  const last = parts.last_name || "";
  return `${first} ${last}`.trim();
}

// Sends two emails: one to the student/applicant introducing the assigned
// staff, and one to the staff member alerting them to the new assignment.
// Either or both can be skipped (e.g. a student with no email).
export async function sendStaffAssignmentEmails(opts: {
  stage: Stage;
  programName: string;
  student: {
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    preferred_name?: string | null;
  };
  staff: {
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    preferred_name?: string | null;
  };
  assignedBy?: {
    first_name: string | null;
    last_name: string | null;
    preferred_name?: string | null;
  } | null;
}) {
  const fromEmail = (process.env.RESEND_FROM_EMAIL || "noreply@ffsahub.com").trim();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ffsahub.com";
  const fromHeader = `Fire & Fragrance SA <${fromEmail}>`;

  const staffName = fullName(opts.staff) || "your point of contact";
  const studentName = fullName(opts.student) || "your student";
  const stageLabel = opts.stage === "application" ? "application" : "enrollment";

  try {
    if (opts.student.email) {
      const firstName = opts.student.first_name || "there";
      await getResend().emails.send({
        from: fromHeader,
        to: opts.student.email,
        subject: `Your ${stageLabel} contact — ${opts.programName}`,
        html: staffAssignedStudentEmailHtml({
          firstName,
          programName: opts.programName,
          staffName,
          staffEmail: opts.staff.email,
          stage: opts.stage,
          siteUrl,
        }),
      });
    }
  } catch {
    // Don't fail the assignment if email fails.
    console.error("Failed to send staff-assignment email to student");
  }

  try {
    if (opts.staff.email) {
      const staffFirstName = opts.staff.first_name || "there";
      const assignedByName = opts.assignedBy ? fullName(opts.assignedBy) || null : null;
      await getResend().emails.send({
        from: fromHeader,
        to: opts.staff.email,
        subject:
          opts.stage === "application"
            ? `New applicant assigned to you — ${opts.programName}`
            : `New student assigned to you — ${opts.programName}`,
        html: staffNewAssignmentEmailHtml({
          staffFirstName,
          studentName,
          programName: opts.programName,
          stage: opts.stage,
          assignedByName,
          siteUrl,
        }),
      });
    }
  } catch {
    console.error("Failed to send staff-assignment email to staff");
  }
}
