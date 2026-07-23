// Column registry for the program student-roster CSV export. Shared by the
// export API route (which builds the CSV) and the Enrollments tab (which
// renders the column picker), so the two can never drift.

export type StudentExportColumnKey =
  | "first_name"
  | "last_name"
  | "preferred_name"
  | "email"
  | "phone"
  | "date_of_birth"
  | "gender"
  | "nationality"
  | "emergency_contact_name"
  | "emergency_contact_phone"
  | "emergency_contact_relationship"
  | "status"
  | "enrolled_at"
  | "assigned_staff"
  | "notes";

// Canonical CSV column order — also the default emitted when nothing is
// deselected, so an un-customized download is stable.
export const STUDENT_EXPORT_COLUMN_ORDER: StudentExportColumnKey[] = [
  "first_name",
  "last_name",
  "preferred_name",
  "email",
  "phone",
  "date_of_birth",
  "gender",
  "nationality",
  "emergency_contact_name",
  "emergency_contact_phone",
  "emergency_contact_relationship",
  "status",
  "enrolled_at",
  "assigned_staff",
  "notes",
];

export const STUDENT_EXPORT_COLUMN_LABELS: Record<
  StudentExportColumnKey,
  string
> = {
  first_name: "First Name",
  last_name: "Last Name",
  preferred_name: "Preferred Name",
  email: "Email",
  phone: "Phone",
  date_of_birth: "Date of Birth",
  gender: "Gender",
  nationality: "Nationality",
  emergency_contact_name: "Emergency Contact Name",
  emergency_contact_phone: "Emergency Contact Phone",
  emergency_contact_relationship: "Emergency Contact Relationship",
  status: "Status",
  enrolled_at: "Enrolled Date",
  assigned_staff: "Assigned Staff",
  notes: "Notes",
};

// Grouping for the column-picker UI. (CSV order stays STUDENT_EXPORT_COLUMN_ORDER.)
export const STUDENT_EXPORT_COLUMN_GROUPS: {
  group: string;
  keys: StudentExportColumnKey[];
}[] = [
  {
    group: "Identity",
    keys: ["first_name", "last_name", "preferred_name", "email"],
  },
  { group: "Contact", keys: ["phone"] },
  { group: "Personal", keys: ["date_of_birth", "gender", "nationality"] },
  {
    group: "Emergency contact",
    keys: [
      "emergency_contact_name",
      "emergency_contact_phone",
      "emergency_contact_relationship",
    ],
  },
  {
    group: "Enrollment",
    keys: ["status", "enrolled_at", "assigned_staff", "notes"],
  },
];

// Human-readable labels for enrollment status. Shared with the Enrollments tab
// so the CSV "Status" column and the on-screen badge read identically.
export const ENROLLMENT_STATUS_LABELS: Record<string, string> = {
  waiting_for_arrival: "Waiting for Arrival",
  arrived: "Arrived",
  dismissed: "Dismissed",
  decided_to_leave: "Decided to Leave",
  graduated: "Graduated",
};

const KEY_SET = new Set<string>(STUDENT_EXPORT_COLUMN_ORDER);

export function isStudentExportColumnKey(
  s: string
): s is StudentExportColumnKey {
  return KEY_SET.has(s);
}

// Parse the ?columns= query param (comma-separated keys), returning the
// selected keys in canonical order. Null / empty / all-invalid → every column
// (so old links and "select everything" both yield the full CSV).
export function parseStudentExportColumns(
  param: string | null
): StudentExportColumnKey[] {
  if (!param) return [...STUDENT_EXPORT_COLUMN_ORDER];
  const requested = new Set(
    param
      .split(",")
      .map((s) => s.trim())
      .filter(isStudentExportColumnKey)
  );
  if (requested.size === 0) return [...STUDENT_EXPORT_COLUMN_ORDER];
  return STUDENT_EXPORT_COLUMN_ORDER.filter((k) => requested.has(k));
}
