import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanManageApplications } from "@/lib/auth/check-schools-access";
import { getEnrollmentsWithPiiByProgram } from "@/services/schools";
import {
  ENROLLMENT_STATUS_LABELS,
  STUDENT_EXPORT_COLUMN_LABELS,
  parseStudentExportColumns,
  type StudentExportColumnKey,
} from "@/lib/schools/student-export-columns";

type StudentUser = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  gender: string | null;
  nationality: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
};

type StaffUser = {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
} | null;

type EnrollmentRow = {
  id: string;
  user_id: string;
  status: string;
  enrolled_at: string | null;
  removed_at: string | null;
  notes: string | null;
  assigned_staff_id: string | null;
  users: StudentUser | null;
  assigned_staff: StaffUser;
};

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

// Full ISO timestamp (used for enrolled_at).
function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

// Date-only YYYY-MM-DD (used for date_of_birth, which is a DATE column).
function formatDateOnly(value: string | null): string {
  if (!value) return "";
  // Already a plain date string from Postgres — take the first 10 chars,
  // avoiding a timezone shift from `new Date(...)`.
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m ? m[1] : value;
}

function staffName(staff: StaffUser): string {
  if (!staff) return "";
  const first = staff.preferred_name ?? staff.first_name ?? "";
  return `${first} ${staff.last_name ?? ""}`.trim();
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ programId: string }> }
) {
  const { programId } = await context.params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await userCanManageApplications(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const selectedColumns = parseStudentExportColumns(
    searchParams.get("columns")
  );

  // Optional whitelist of student user_ids. Omitted → all active students.
  const studentsParam = searchParams.get("students");
  const studentFilter = studentsParam
    ? new Set(
        studentsParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      )
    : null;

  // PII beyond name/email is RLS-blocked for non-admins, so read with the
  // service-role client. Results go straight into the CSV response below —
  // they are never handed to a client component.
  const admin = createAdminClient();

  const { data: program } = await admin
    .from("programs")
    .select("id, name, code")
    .eq("id", programId)
    .single();
  if (!program) {
    return NextResponse.json({ error: "Program not found" }, { status: 404 });
  }

  const { data: enrollments, error } = await getEnrollmentsWithPiiByProgram(
    admin,
    programId
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = ((enrollments ?? []) as EnrollmentRow[]).filter((e) => {
    // An explicit ?students= list is authoritative — it may deliberately
    // include removed students (the picker's "Include removed" option), so we
    // honour the whitelist as-is. With no list, default to active students.
    if (studentFilter) return studentFilter.has(e.user_id);
    return !e.removed_at;
  });

  const VALUE: Record<StudentExportColumnKey, (e: EnrollmentRow) => string> = {
    first_name: (e) => e.users?.first_name ?? "",
    last_name: (e) => e.users?.last_name ?? "",
    preferred_name: (e) => e.users?.preferred_name ?? "",
    email: (e) => e.users?.email ?? "",
    phone: (e) => e.users?.phone ?? "",
    date_of_birth: (e) => formatDateOnly(e.users?.date_of_birth ?? null),
    gender: (e) => e.users?.gender ?? "",
    nationality: (e) => e.users?.nationality ?? "",
    emergency_contact_name: (e) => e.users?.emergency_contact_name ?? "",
    emergency_contact_phone: (e) => e.users?.emergency_contact_phone ?? "",
    emergency_contact_relationship: (e) =>
      e.users?.emergency_contact_relationship ?? "",
    status: (e) => ENROLLMENT_STATUS_LABELS[e.status] ?? e.status,
    enrolled_at: (e) => formatDateTime(e.enrolled_at),
    assigned_staff: (e) => staffName(e.assigned_staff),
    notes: (e) => e.notes ?? "",
  };

  const headers = selectedColumns.map((k) => STUDENT_EXPORT_COLUMN_LABELS[k]);
  const lines = [headers.map(escapeCsvValue).join(",")];
  for (const e of rows) {
    const cells = selectedColumns.map((k) => VALUE[k](e));
    lines.push(cells.map(escapeCsvValue).join(","));
  }
  const csv = lines.join("\n");

  // Record the bulk-PII export for traceability (mirrors the enrollments
  // remove/delete audit rows).
  await admin.from("audit_logs").insert({
    user_id: user.id,
    action: "export_enrollments_csv",
    resource_type: "programs",
    resource_id: programId,
  });

  const filename = `students-${slugify(program.code || program.name) || "program"}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
